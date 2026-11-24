import { test } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import nodemailer from "nodemailer";
import { chromium } from "playwright";
import request from "supertest";

if (process.env.NODE_ENV !== "test") throw Error("Gunakan database uji terpisah");
process.env.APP_ORIGIN = "http://127.0.0.1:3186";
const { app } = await import("../server/app.js");
const { db, hash, random } = await import("../server/core.js");
const { clearAdminOtp } = await import("../server/admin-otp.js");
const requestPath = "/api/auth/otp/request";
const verifyPath = "/api/auth/otp/verify";

test("login OTP admin aktif BCU, pembatasan dan sesi", async (t) => {
  const server = app.listen(3186, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const messages = [];
  const smtp = t.mock.method(nodemailer, "createTransport", () => ({
    async sendMail(message) {
      messages.push(message);
      return { accepted: [message.to], rejected: [] };
    },
  }));
  const initialLimit = await db.setting.findUniqueOrThrow({ where: { key: "login_limit" } });
  const host = process.env.SMTP_HOST;
  process.env.SMTP_HOST = "smtp.example.test";
  await db.setting.update({ where: { key: "login_limit" }, data: { value: 30 } });

  async function actor() {
    const agent = request.agent(server);
    const csrf = (await agent.get("/api/csrf")).body.token;
    return { agent, post: (path, body) => agent.post(path).set("X-CSRF-Token", csrf).send(body) };
  }
  async function account(email, active = true) {
    return db.admin.create({
      data: { email, name: email, password: await bcrypt.hash("OtpUji!2026", 4), role: "admin", active },
    });
  }
  function codeFor(email) {
    return messages.findLast((message) => message.to === email)?.text.match(/\b\d{6}\b/)?.[0];
  }
  const validEmail = process.env.ADMIN_EMAIL;
  try {
    await t.test("domain luar ditolak walaupun password benar dan session pernah ada", async () => {
      const legacy = await account("legacy-otp@example.test");
      const user = await actor();
      await user.agent.post(requestPath).send({ email: validEmail }).expect(403);
      await user.post("/api/auth/login", { email: legacy.email, password: "OtpUji!2026" }).expect(401);
      await user.post(requestPath, { email: legacy.email }).expect(422);
      await user.post(requestPath, { email: "pegawai@bcupt.id.example.test" }).expect(422);
      await user.post(verifyPath, { email: legacy.email, challenge: random(), code: "123456" }).expect(422);
      const session = random();
      await db.session.create({ data: {
        id: hash(session), adminId: legacy.id, csrf: random(), expiresAt: new Date(Date.now() + 60000),
      } });
      const { default: cookieSignature } = await import("cookie-signature");
      const cookie = encodeURIComponent("s:" + cookieSignature.sign(session, process.env.SESSION_SECRET));
      assert.equal((await request(server).get("/api/auth/me").set("Cookie", "roi_session=" + cookie)).body.admin, null);
      assert.equal(messages.length, 0);
    });

    await t.test("akun nonaktif tidak mendapat OTP atau sesi", async () => {
      const inactive = await account("otp-inactive@bcupt.id", false);
      const user = await actor();
      const response = await user.post(requestPath, { email: inactive.email }).expect(202);
      assert.deepEqual(Object.keys(response.body).sort(), ["challenge", "resendAfter"]);
      await user.post(verifyPath, { email: inactive.email, challenge: response.body.challenge, code: "123456" }).expect(401);
      assert.equal(messages.length, 0);
      assert.equal((await user.agent.get("/api/auth/me")).body.admin, null);
    });

    await t.test("kode hanya dapat dipakai sekali oleh browser peminta", async () => {
      const user = await actor(), other = await actor();
      const requested = await user.post(requestPath, { email: validEmail.toUpperCase() }).expect(202);
      const { challenge } = requested.body;
      const code = codeFor(validEmail);
      assert.match(code, /^\d{6}$/);
      assert.equal(messages.length, 1);
      assert.equal(requested.headers["set-cookie"], undefined);
      assert.equal((await user.agent.get("/api/auth/me")).body.admin, null);
      await other.post(requestPath, { email: validEmail }).expect(429);
      await other.post(verifyPath, { email: validEmail, challenge, code }).expect(401);
      const wrongCode = code === "111111" ? "222222" : "111111";
      await user.post(verifyPath, { email: validEmail, challenge, code: wrongCode }).expect(401);
      const results = await Promise.all([1, 2].map(() => user.post(verifyPath, { email: validEmail, challenge, code })));
      assert.deepEqual(results.map((r) => r.status).sort(), [200, 401]);
      assert.match(results.find((r) => r.status === 200).headers["set-cookie"].join(";"), /HttpOnly/);
      assert.equal((await user.agent.get("/api/auth/me")).body.admin.email, validEmail);
      const logs = await db.activityLog.findMany({ where: { action: "auth.otp_sent" } });
      assert.ok(logs.some((entry) => entry.after.email === validEmail));
      assert.ok(logs.every((entry) => Object.keys(entry.after).length === 1));
    });

    await t.test("lima tebakan dan kode kedaluwarsa menutup tantangan", async () => {
      const user = await actor();
      const locked = await account("otp-locked@bcupt.id");
      const lockedRequest = await user.post(requestPath, { email: locked.email }).expect(202);
      const code = codeFor(locked.email);
      const wrong = code === "111111" ? "222222" : "111111";
      const payload = { email: locked.email, challenge: lockedRequest.body.challenge };
      for (let i = 0; i < 5; i++) await user.post(verifyPath, { ...payload, code: wrong }).expect(401);
      await user.post(verifyPath, { ...payload, code }).expect(401);

      const expired = await account("otp-expired@bcupt.id");
      const realNow = Date.now;
      const clock = t.mock.method(Date, "now", () => realNow() - 6 * 60000);
      let expiredRequest;
      try {
        expiredRequest = await user.post(requestPath, { email: expired.email }).expect(202);
      } finally {
        clock.mock.restore();
      }
      await user.post(verifyPath, {
        email: expired.email, challenge: expiredRequest.body.challenge, code: codeFor(expired.email),
      }).expect(401);
      assert.equal((await user.agent.get("/api/auth/me")).body.admin, null);
    });

    await t.test("pendaftaran OTP tidak dapat mengambil alih akun yang baru dibuat", async () => {
      const email = "otp-race@bcupt.id";
      const user = await actor();
      const { body: { challenge } } = await user.post(requestPath, { email }).expect(202);
      await account(email);
      await user.post(verifyPath, { email, challenge, code: codeFor(email) }).expect(401);
      assert.equal((await user.agent.get("/api/auth/me")).body.admin, null);
    });

    await t.test("OTP pertama membuat akun User dan membatasi akses master di browser serta API", async () => {
      const email = "otp-ui@bcupt.id";
      const browser = await chromium.launch();
      try {
        const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
        const origin = process.env.APP_ORIGIN;
        await page.goto(origin + "/admin/eksternal/data-form");
        await page.getByRole("button", { name: "OTP email BCU" }).click();
        await page.getByLabel("Email", { exact: true }).fill(email);
        await page.getByRole("button", { name: "Kirim kode OTP" }).click();
        await page.getByLabel("Kode OTP", { exact: true }).waitFor();
        assert.ok(await page.getByRole("button", { name: /Kirim ulang/ }).isDisabled());
        assert.equal(await db.admin.findUnique({ where: { email } }), null);
        await page.getByLabel("Kode OTP", { exact: true }).fill(codeFor(email));
        await page.getByRole("button", { name: "Verifikasi dan masuk" }).click();
        await page.getByRole("heading", { name: "Data Form", exact: true }).waitFor();
        assert.equal(new URL(page.url()).pathname, "/admin/eksternal/data-form");
        assert.equal(await page.getByRole("button", { name: /XLSX/ }).count(), 0);
        const created = await db.admin.findUniqueOrThrow({ where: { email } });
        assert.equal(created.role, "user");
        assert.equal(created.active, true);
        const me = await (await page.request.get(origin + "/api/auth/me")).json();
        assert.deepEqual(me.admin.menus, ["data"]);
        for (const mode of ["internal", "eksternal"]) {
          const get = (resource) => page.request.get(origin + "/api/admin/" + resource, { headers: { "X-ROI-Mode": mode } });
          assert.equal((await get("submissions")).status(), 200);
          for (const blocked of ["settings", "custom", "dashboard", "submissions/export/csv", "submissions/any/document/pdf", "uploads/any"])
            assert.equal((await get(blocked)).status(), 403, blocked);
        }
      } finally {
        await browser.close();
      }
    });
    assert.equal(smtp.mock.callCount(), messages.length);
  } finally {
    clearAdminOtp();
    if (host === undefined) delete process.env.SMTP_HOST;
    else process.env.SMTP_HOST = host;
    await db.setting.update({ where: { key: initialLimit.key }, data: { value: initialLimit.value } });
    await new Promise((resolve) => server.close(resolve));
    await db.$disconnect();
  }
});
