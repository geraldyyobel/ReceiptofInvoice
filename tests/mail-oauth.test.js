import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { app } from "../server/app.js";
import { db, encrypt, decrypt } from "../server/core.js";
import { connectionKey, sendConnectedMail } from "../server/mail-oauth.js";
import { sendMail, closeBrowser } from "../server/documents.js";
const server = app.listen(0, "127.0.0.1");
before(() =>
  server.listening
    ? undefined
    : new Promise((r) => server.once("listening", r)),
);
const originalFetch = globalThis.fetch;
after(async () => {
  globalThis.fetch = originalFetch;
  await closeBrowser();
  await new Promise((r) => server.close(r));
  await db.$disconnect();
});
test("OAuth email: role, callback, state/PKCE, token, refresh dan pengiriman kedua provider", async (t) => {
  process.env.GOOGLE_CLIENT_ID = "google-client";
  process.env.GOOGLE_CLIENT_SECRET = "google-client-secret";
  process.env.MICROSOFT_CLIENT_ID = "microsoft-client";
  process.env.MICROSOFT_CLIENT_SECRET = "microsoft-client-secret";
  process.env.MICROSOFT_TENANT_ID = "common";
  const admin = request.agent(server),
    anon = request.agent(server);
  let csrf = (await admin.get("/api/csrf")).body.token;
  const post = (url, body = {}) =>
    admin.post(url).set("X-CSRF-Token", csrf).send(body);
  await post("/api/auth/login", {
    email: process.env.ADMIN_EMAIL,
    password: process.env.ADMIN_PASSWORD,
  }).expect(200);
  await post("/api/admin/mode", { mode: "eksternal" }).expect(200);
  let sent = [],
    exchanges = 0,
    refreshes = 0,
    denyRefresh = false;
  const json = (body, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  globalThis.fetch = async (url, opts = {}) => {
    url = String(url);
    if (url.endsWith("/token")) {
      const params = new URLSearchParams(opts.body),
        gmail = url.includes("googleapis");
      if (params.get("grant_type") === "refresh_token") {
        refreshes++;
        if (denyRefresh) return json({ error: "invalid_grant" }, 400);
        return json({
          access_token: gmail
            ? "access-gmail-refreshed"
            : "access-outlook-refreshed",
          refresh_token: gmail
            ? "refresh-gmail-rotated"
            : "refresh-outlook-rotated",
          expires_in: 3600,
        });
      }
      exchanges++;
      assert.ok(params.get("code_verifier"));
      assert.ok(params.get("client_secret"));
      assert.match(
        params.get("redirect_uri"),
        /\/api\/email\/oauth\/(gmail|outlook)\/callback$/,
      );
      return json({
        access_token: gmail ? "access-gmail" : "access-outlook",
        refresh_token: gmail ? "refresh-gmail" : "refresh-outlook",
        expires_in: 3600,
      });
    }
    if (url.includes("openidconnect.googleapis.com"))
      return json({ email: "pengirim@gmail.com", email_verified: true });
    if (url.startsWith("https://graph.microsoft.com/v1.0/me?"))
      return json({
        mail: "pengirim@outlook.com",
        userPrincipalName: "pengirim@outlook.com",
      });
    if (url.endsWith("/sendMail") || url.endsWith("/messages/send")) {
      sent.push({ url, headers: opts.headers, body: JSON.parse(opts.body) });
      return url.endsWith("/sendMail")
        ? new Response(null, { status: 202 })
        : json({ id: "message-mock" });
    }
    throw Error("Jaringan tidak dimock: " + url);
  };
  async function start(provider) {
    const r = await post("/api/admin/mail/oauth/" + provider + "/start").expect(
        200,
      ),
      u = new URL(r.body.url);
    return {
      state: u.searchParams.get("state"),
      url: u,
      cookie: r.headers["set-cookie"]
        .find((c) => c.startsWith("roi_mail_oauth="))
        .split(";")[0],
      headers: r.headers,
    };
  }
  async function callback(provider, flow, extra = "code=mock-code") {
    return request(server)
      .get(
        "/api/email/oauth/" +
          provider +
          "/callback?state=" +
          flow.state +
          "&" +
          extra,
      )
      .set("Cookie", flow.cookie)
      .expect(302);
  }
  await t.test(
    "akses dibatasi Super Admin dan kredensial kosong tidak memberikan tautan palsu",
    async () => {
      await anon.get("/api/admin/mail/status").expect(401);
      const basic = request.agent(server),
        bc = (await basic.get("/api/csrf")).body.token;
      await basic
        .post("/api/auth/login")
        .set("X-CSRF-Token", bc)
        .send({ email: "biasa@example.com", password: "PasswordUji!2026" })
        .expect(200);
      await basic
        .post("/api/admin/mode")
        .set("X-CSRF-Token", bc)
        .send({ mode: "eksternal" })
        .expect(200);
      await basic.get("/api/admin/mail/status").expect(403);
      await basic
        .post("/api/admin/mail/oauth/gmail/start")
        .set("X-CSRF-Token", bc)
        .send({})
        .expect(403);
      delete process.env.GOOGLE_CLIENT_SECRET;
      await post("/api/admin/mail/oauth/gmail/start").expect(409);
      process.env.GOOGLE_CLIENT_SECRET = "google-client-secret";
    },
  );
  await t.test(
    "callback tidak memerlukan cookie session Strict, tetapi wajib binding Lax dan state sekali pakai",
    async () => {
      const f = await start("gmail");
      assert.equal(f.url.origin, "https://accounts.google.com");
      assert.equal(f.url.searchParams.get("code_challenge_method"), "S256");
      assert.equal(f.url.searchParams.get("access_type"), "offline");
      assert.match(f.headers["set-cookie"].join(";"), /HttpOnly.*SameSite=Lax/);
      assert.match(f.url.searchParams.get("scope"), /gmail.send/);
      assert.ok(!f.url.searchParams.get("scope").includes("mail.google.com"));
      const bad = await request(server)
        .get("/api/email/oauth/gmail/callback?state=" + f.state + "&code=mock")
        .expect(302);
      assert.match(bad.headers.location, /mail_oauth=error/);
      assert.equal(exchanges, 0);
      const mismatch = await callback("outlook", f);
      assert.match(mismatch.headers.location, /mail_oauth=error/);
      assert.equal(exchanges, 0);
      const ok = await callback("gmail", f);
      assert.match(ok.headers.location, /mail_oauth=success/);
      assert.equal(exchanges, 1);
      const replay = await callback("gmail", f);
      assert.match(replay.headers.location, /mail_oauth=error/);
      assert.equal(exchanges, 1);
      const c = await db.setting.findUnique({
        where: { key: connectionKey("gmail") },
      });
      assert.ok(!String(c.value).includes("refresh-gmail"));
      const response = (await admin.get("/api/admin/settings")).body;
      assert.equal(response.email_transport, "gmail");
      assert.equal(response.email_pengirim, "pengirim@gmail.com");
      assert.ok(!JSON.stringify(response).includes("mail_oauth_"));
      assert.ok(
        !JSON.stringify(
          (await admin.get("/api/admin/mail/status")).body,
        ).includes("access-gmail"),
      );
    },
  );
  await t.test(
    "izin dibatalkan tidak mengganti koneksi yang sudah ada",
    async () => {
      const f = await start("gmail");
      const r = await callback("gmail", f, "error=access_denied");
      assert.match(r.headers.location, /mail_oauth=denied/);
      assert.equal(exchanges, 1);
      assert.equal(
        (await admin.get("/api/admin/mail/status")).body.providers.gmail.email,
        "pengirim@gmail.com",
      );
    },
  );
  await t.test(
    "Gmail mengirim MIME lampiran dan memperbarui token kedaluwarsa tanpa kebocoran log",
    async () => {
      const c = await db.setting.findUnique({
          where: { key: connectionKey("gmail") },
        }),
        data = JSON.parse(decrypt(Buffer.from(c.value, "base64")).toString());
      data.expiresAt = Date.now() - 1000;
      await db.setting.update({
        where: { key: c.key },
        data: { value: encrypt(JSON.stringify(data)).toString("base64") },
      });
      await sendConnectedMail("gmail", {
        from: "alamat-palsu@example.com",
        to: "penerima@example.com",
        subject: "Uji ROI",
        text: "Dokumen uji",
        attachments: [
          {
            filename: "ROI.pdf",
            content: Buffer.from("%PDF-mock"),
            contentType: "application/pdf",
          },
        ],
      });
      assert.equal(refreshes, 1);
      const msg = sent.at(-1);
      assert.match(msg.headers.Authorization, /access-gmail-refreshed/);
      const mime = Buffer.from(msg.body.raw, "base64url").toString();
      assert.match(mime, /From: pengirim@gmail.com/);
      assert.match(mime, /application\/pdf/);
      assert.ok(!mime.includes("alamat-palsu"));
      await sendMail({
        recipient: "tes@example.com",
        req: { mode: "eksternal" },
      });
      assert.equal(sent.length, 2);
      await admin
        .put("/api/admin/settings")
        .set("X-CSRF-Token", csrf)
        .send({ email_subjek: "Judul uji OAuth" })
        .expect(200);
      const logs = JSON.stringify(await db.activityLog.findMany());
      assert.ok(!logs.includes("access-gmail"));
      assert.ok(!logs.includes("refresh-gmail"));
      assert.ok(!logs.includes("google-client-secret"));
    },
  );
  await t.test(
    "Outlook Graph mendukung lampiran dan pengirim akun terhubung",
    async () => {
      const f = await start("outlook");
      assert.equal(f.url.origin, "https://login.microsoftonline.com");
      assert.match(f.url.searchParams.get("scope"), /Mail.Send/);
      assert.match(f.url.searchParams.get("scope"), /offline_access/);
      await callback("outlook", f);
      await sendConnectedMail("outlook", {
        from: "palsu@example.com",
        to: "tes@example.com",
        subject: "Uji",
        text: "Isi",
        attachments: [
          {
            filename: "ROI.pdf",
            content: Buffer.from("%PDF-mock"),
            contentType: "application/pdf",
          },
        ],
      });
      const msg = sent.at(-1);
      assert.equal(
        msg.body.message.from.emailAddress.address,
        "pengirim@outlook.com",
      );
      assert.equal(
        msg.body.message.attachments[0].contentBytes,
        Buffer.from("%PDF-mock").toString("base64"),
      );
      assert.equal(msg.body.saveToSentItems, true);
      await admin
        .put("/api/admin/settings")
        .set("X-CSRF-Token", csrf)
        .send({ email_pengirim: "palsu@example.com" })
        .expect(422);
    },
  );
  await t.test(
    "refresh token dicabut menandai perlu login ulang; disconnect tidak beralih SMTP diam-diam",
    async () => {
      const c = await db.setting.findUnique({
          where: { key: connectionKey("gmail") },
        }),
        data = JSON.parse(decrypt(Buffer.from(c.value, "base64")).toString());
      data.expiresAt = 0;
      await db.setting.update({
        where: { key: c.key },
        data: { value: encrypt(JSON.stringify(data)).toString("base64") },
      });
      denyRefresh = true;
      await assert.rejects(() =>
        sendConnectedMail("gmail", {
          to: "tes@example.com",
          subject: "Uji",
          text: "Isi",
        }),
      );
      assert.equal(
        (await admin.get("/api/admin/mail/status")).body.providers.gmail
          .needsReconnect,
        true,
      );
      await admin
        .delete("/api/admin/mail/oauth/outlook")
        .set("X-CSRF-Token", csrf)
        .expect(200);
      assert.equal(
        (await admin.get("/api/admin/settings")).body.email_transport,
        "none",
      );
      await assert.rejects(() =>
        sendMail({ recipient: "tes@example.com", req: { mode: "eksternal" } }),
      );
    },
  );
  await t.test("callback ditolak jika Super Admin sudah logout", async () => {
    const flow = await start("gmail"),
      before = exchanges;
    await post("/api/auth/logout").expect(200);
    const response = await callback("gmail", flow);
    assert.match(response.headers.location, /mail_oauth=error/);
    assert.equal(exchanges, before);
  });
});
