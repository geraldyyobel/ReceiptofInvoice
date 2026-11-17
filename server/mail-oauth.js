import crypto from "node:crypto";
import nodemailer from "nodemailer";
import {
  db,
  encrypt,
  decrypt,
  hash,
  random,
  equal,
  fail,
  audit,
} from "./core.js";
import { EMAIL } from "../shared/engine.js";

const prefix = "mail_oauth_";
export const oauthCookie = "roi_mail_oauth";
export const oauthCookieOptions = {
  httpOnly: true,
  signed: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  path: "/api/email/oauth",
  maxAge: 600000,
};
export const connectionKey = (p) => prefix + "connection_" + p;
const encode = (o) => encrypt(JSON.stringify(o)).toString("base64");
const decode = (s) => JSON.parse(decrypt(Buffer.from(s, "base64")).toString());
export const safeMailSettings = (s) =>
  Object.fromEntries(Object.entries(s).filter(([k]) => !k.startsWith(prefix)));
export function mailOrigin() {
  const allowed = (process.env.APP_ORIGIN || "http://localhost:5173")
    .split(",")
    .map((s) => s.trim());
  const u = new URL(process.env.MAIL_OAUTH_ORIGIN || allowed[0]);
  if (
    !allowed.includes(u.origin) ||
    u.username ||
    u.password ||
    u.search ||
    u.hash ||
    u.pathname !== "/" ||
    (u.protocol !== "https:" &&
      !(
        u.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)
      ))
  )
    throw fail(
      "Alamat callback OAuth harus memakai origin aplikasi yang diizinkan dan HTTPS (localhost boleh HTTP).",
    );
  return u.origin;
}
export function providerConfig(p) {
  if (!["gmail", "outlook"].includes(p))
    throw fail("Penyedia email tidak dikenal");
  const outlook = p === "outlook",
    envPrefix = outlook ? "MICROSOFT" : "GOOGLE";
  const clientId = process.env[envPrefix + "_CLIENT_ID"],
    clientSecret = process.env[envPrefix + "_CLIENT_SECRET"];
  const tenant = process.env.MICROSOFT_TENANT_ID || "common";
  if (outlook && !/^[a-zA-Z0-9.-]+$/.test(tenant))
    throw fail("MICROSOFT_TENANT_ID tidak valid");
  return {
    provider: p,
    clientId,
    clientSecret,
    configured: !!(clientId && clientSecret),
    missing: [
      !clientId ? envPrefix + "_CLIENT_ID" : null,
      !clientSecret ? envPrefix + "_CLIENT_SECRET" : null,
    ].filter(Boolean),
    redirectUri: mailOrigin() + `/api/email/oauth/${p}/callback`,
    authorize: outlook
      ? `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`
      : "https://accounts.google.com/o/oauth2/v2/auth",
    token: outlook
      ? `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`
      : "https://oauth2.googleapis.com/token",
    scope: outlook
      ? "https://graph.microsoft.com/User.Read https://graph.microsoft.com/Mail.Send offline_access"
      : "openid email https://www.googleapis.com/auth/gmail.send",
  };
}
export async function mailConnectionStatus() {
  const result = {};
  for (const provider of ["outlook", "gmail"]) {
    let cfg;
    try {
      cfg = providerConfig(provider);
    } catch (e) {
      result[provider] = {
        configured: false,
        connected: false,
        configurationError: e.message,
      };
      continue;
    }
    const record = await db.setting.findUnique({
      where: { key: connectionKey(provider) },
    });
    let account;
    try {
      account = record ? decode(record.value) : null;
    } catch {}
    result[provider] = {
      configured: cfg.configured,
      missing: cfg.missing,
      redirectUri: cfg.redirectUri,
      connected: !!account,
      email: account?.email,
      connectedAt: account?.connectedAt,
      needsReconnect: !!account?.needsReconnect,
    };
  }
  return result;
}
export async function beginMailConnection(req, res, provider) {
  const cfg = providerConfig(provider);
  if (!cfg.configured)
    throw fail(
      "Login " + provider + " belum dikonfigurasi oleh pengelola server.",
      409,
    );
  if (req.headers?.origin && req.headers.origin !== mailOrigin())
    throw fail(
      "Buka aplikasi melalui " +
        mailOrigin() +
        " sebelum menghubungkan akun email.",
      409,
    );
  const flows = await db.setting.findMany({
    where: { key: { startsWith: prefix + "flow_" } },
  });
  for (const entry of flows)
    if (entry.value.expiresAt < Date.now())
      await db.setting.deleteMany({ where: { key: entry.key } });
  if (flows.filter((f) => f.value.expiresAt > Date.now()).length >= 20)
    throw fail(
      "Terlalu banyak proses login email. Tunggu hingga proses sebelumnya kedaluwarsa.",
      429,
    );
  const state = random(),
    binding = random(),
    verifier = random(),
    expiresAt = Date.now() + 600000;
  const flow = {
    provider,
    bindingHash: hash(binding),
    verifier,
    redirectUri: cfg.redirectUri,
    sessionId: req.session.id,
    adminId: req.admin.id,
    expiresAt,
  };
  await db.setting.create({
    data: {
      key: prefix + "flow_" + hash(state),
      value: { expiresAt, ciphertext: encode(flow) },
    },
  });
  res.cookie(oauthCookie, binding, oauthCookieOptions);
  const url = new URL(cfg.authorize);
  for (const [k, v] of Object.entries({
    client_id: cfg.clientId,
    response_type: "code",
    redirect_uri: cfg.redirectUri,
    scope: cfg.scope,
    state,
    code_challenge: crypto
      .createHash("sha256")
      .update(verifier)
      .digest("base64url"),
    code_challenge_method: "S256",
    ...(provider === "gmail"
      ? { access_type: "offline", prompt: "consent select_account" }
      : { response_mode: "query", prompt: "select_account" }),
  }))
    url.searchParams.set(k, v);
  await audit(req, "mail.oauth.start", null, { provider }, null);
  return { url: url.toString() };
}
export async function claimMailFlow(provider, state, binding) {
  if (
    typeof state !== "string" ||
    state.length > 200 ||
    typeof binding !== "string"
  )
    throw fail("Proses login email tidak valid atau kedaluwarsa.", 403);
  const key = prefix + "flow_" + hash(state),
    record = await db.setting.findUnique({ where: { key } });
  if (!record)
    throw fail("Proses login email tidak valid atau sudah digunakan.", 403);
  const flow = decode(record.value.ciphertext);
  if (
    flow.provider !== provider ||
    flow.expiresAt < Date.now() ||
    !equal(flow.bindingHash, hash(binding))
  )
    throw fail("Proses login email tidak valid atau kedaluwarsa.", 403);
  const session = await db.session.findUnique({
      where: { id: flow.sessionId },
    }),
    admin = await db.admin.findUnique({ where: { id: flow.adminId } });
  if (
    !session ||
    session.adminId !== flow.adminId ||
    session.expiresAt < new Date() ||
    !admin?.active ||
    admin.role !== "superadmin"
  )
    throw fail("Session Super Admin sudah berakhir. Login kembali.", 403);
  if ((await db.setting.deleteMany({ where: { key } })).count !== 1)
    throw fail("Proses login email sudah digunakan.", 403);
  return { ...flow, admin };
}
async function tokenRequest(cfg, params, fetcher) {
  if (!cfg.configured)
    throw fail("Konfigurasi OAuth email belum lengkap.", 409);
  let response;
  try {
    response = await fetcher(cfg.token, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        ...params,
      }),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw fail("Penyedia email tidak dapat dihubungi. Coba kembali.", 502);
  }
  if (!response.ok)
    throw fail(
      "Izin email tidak valid atau telah dicabut. Hubungkan kembali akun.",
      502,
      { needsReconnect: [400, 401].includes(response.status) },
    );
  let token;
  try {
    token = await response.json();
  } catch {
    throw fail("Respons token dari penyedia email tidak valid.", 502);
  }
  if (typeof token.access_token !== "string" || !token.access_token)
    throw fail("Penyedia email tidak mengembalikan token yang valid.", 502);
  return token;
}
async function accountProfile(provider, token, fetcher) {
  const url =
    provider === "outlook"
      ? "https://graph.microsoft.com/v1.0/me?$select=id,mail,userPrincipalName"
      : "https://openidconnect.googleapis.com/v1/userinfo";
  const r = await fetcher(url, {
    headers: { Authorization: "Bearer " + token },
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw fail("Identitas akun email tidak dapat diverifikasi.", 502);
  const profile = await r.json(),
    email =
      provider === "outlook"
        ? profile.mail || profile.userPrincipalName
        : profile.email;
  if (
    typeof email !== "string" ||
    email.length > 254 ||
    !EMAIL.test(email) ||
    (provider === "gmail" && profile.email_verified !== true)
  )
    throw fail("Akun tidak memiliki alamat email terverifikasi.", 422);
  return email;
}
export async function completeMailConnection(
  flow,
  code,
  req,
  fetcher = globalThis.fetch,
) {
  if (typeof code !== "string" || !code || code.length > 20000)
    throw fail("Kode otorisasi tidak valid");
  const cfg = providerConfig(flow.provider),
    token = await tokenRequest(
      cfg,
      {
        grant_type: "authorization_code",
        code,
        redirect_uri: flow.redirectUri,
        code_verifier: flow.verifier,
      },
      fetcher,
    );
  if (typeof token.refresh_token !== "string" || !token.refresh_token)
    throw fail(
      "Izin untuk pengiriman berkelanjutan belum diberikan. Hubungkan kembali dan setujui izin offline.",
      422,
    );
  const email = await accountProfile(
    flow.provider,
    token.access_token,
    fetcher,
  );
  const account = {
    id: random(),
    provider: flow.provider,
    email,
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresAt:
      Date.now() + Math.max(1, Number(token.expires_in) || 3600) * 1000,
    connectedAt: new Date().toISOString(),
    needsReconnect: false,
  };
  await db.$transaction(async (tx) => {
    const session = await tx.session.findUnique({
        where: { id: flow.sessionId },
      }),
      admin = await tx.admin.findUnique({ where: { id: flow.adminId } });
    if (
      !session ||
      session.expiresAt < new Date() ||
      !admin?.active ||
      admin.role !== "superadmin"
    )
      throw fail("Session Super Admin sudah berakhir.", 403);
    for (const [key, value] of [
      [connectionKey(flow.provider), encode(account)],
      ["email_transport", flow.provider],
      ["email_pengirim", email],
    ])
      await tx.setting.upsert({
        where: { key },
        create: { key, value },
        update: { value },
      });
    await audit(
      { ...req, admin: flow.admin },
      "mail.oauth.connected",
      null,
      { provider: flow.provider, email },
      null,
      tx,
    );
  });
  return { provider: flow.provider, email };
}
export async function disconnectMail(provider, req) {
  providerConfig(provider);
  await db.$transaction(async (tx) => {
    await tx.setting.deleteMany({ where: { key: connectionKey(provider) } });
    const method = await tx.setting.findUnique({
      where: { key: "email_transport" },
    });
    if (method?.value === provider)
      await tx.setting.update({
        where: { key: "email_transport" },
        data: { value: "none" },
      });
    await audit(req, "mail.oauth.disconnected", null, { provider }, null, tx);
  });
}
const refreshLocks = new Map();
async function accessAccount(provider, fetcher) {
  const record = await db.setting.findUnique({
    where: { key: connectionKey(provider) },
  });
  if (!record)
    throw fail(
      "Akun " + provider + " belum terhubung. Hubungkan akun di Settings.",
      409,
    );
  const account = decode(record.value);
  if (account.needsReconnect)
    throw fail("Izin email perlu diperbarui. Hubungkan kembali akun.", 409);
  if (account.expiresAt > Date.now() + 60000) return account;
  if (refreshLocks.has(provider)) return refreshLocks.get(provider);
  const task = (async () => {
    let token;
    try {
      token = await tokenRequest(
        providerConfig(provider),
        { grant_type: "refresh_token", refresh_token: account.refreshToken },
        fetcher,
      );
    } catch (e) {
      // Mark only this connection; do not resurrect a disconnected/replaced account.
      if (e.details?.needsReconnect)
        await db.setting.updateMany({
          where: {
            key: connectionKey(provider),
            value: { equals: record.value },
          },
          data: { value: encode({ ...account, needsReconnect: true }) },
        });
      throw e;
    }
    const next = {
      ...account,
      accessToken: token.access_token,
      refreshToken: token.refresh_token || account.refreshToken,
      expiresAt:
        Date.now() + Math.max(1, Number(token.expires_in) || 3600) * 1000,
    };
    const saved = await db.setting.updateMany({
      where: { key: connectionKey(provider), value: { equals: record.value } },
      data: { value: encode(next) },
    });
    if (saved.count !== 1)
      throw fail("Koneksi email berubah. Ulangi pengiriman.", 409);
    return next;
  })();
  refreshLocks.set(provider, task);
  try {
    return await task;
  } finally {
    refreshLocks.delete(provider);
  }
}
export async function sendConnectedMail(
  provider,
  message,
  fetcher = globalThis.fetch,
) {
  const account = await accessAccount(provider, fetcher),
    headers = {
      Authorization: "Bearer " + account.accessToken,
      "Content-Type": "application/json",
    };
  let url, body;
  if (provider === "gmail") {
    const mime = await nodemailer
      .createTransport({ streamTransport: true, buffer: true })
      .sendMail({ ...message, from: account.email });
    url = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";
    body = { raw: mime.message.toString("base64url") };
  } else {
    if (
      (message.attachments || []).reduce((n, a) => n + a.content.length, 0) >
      3 * 1024 * 1024
    )
      throw fail(
        "PDF melebihi batas lampiran Outlook 3 MB untuk pengiriman langsung.",
        422,
      );
    url = "https://graph.microsoft.com/v1.0/me/sendMail";
    body = {
      message: {
        subject: message.subject,
        body: { contentType: "Text", content: message.text },
        from: { emailAddress: { address: account.email } },
        toRecipients: [{ emailAddress: { address: message.to } }],
        attachments: (message.attachments || []).map((a) => ({
          "@odata.type": "#microsoft.graph.fileAttachment",
          name: a.filename,
          contentType: a.contentType,
          contentBytes: a.content.toString("base64"),
        })),
      },
      saveToSentItems: true,
    };
  }
  let r;
  try {
    r = await fetcher(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
  } catch {
    throw fail(
      "Pengiriman ke penyedia email terputus. Periksa Email Log dan folder Terkirim sebelum mencoba ulang.",
      502,
    );
  }
  if (!r.ok)
    throw fail(
      "Penyedia email menolak pengiriman (HTTP " +
        r.status +
        "). Periksa izin akun atau hubungkan kembali.",
      502,
    );
  return { provider, email: account.email };
}
