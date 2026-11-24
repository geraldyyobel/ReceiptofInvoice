import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
process.env.APP_ORIGIN = "http://127.0.0.1:3187";
const { app } = await import("../server/app.js");
const { db, settings, encrypt } = await import("../server/core.js");
const { sendMail, closeBrowser } = await import("../server/documents.js");
const { removeDeprecatedMailSettings } = await import("../server/mail-settings.js");
const { createBackup, restoreBackup } = await import("../server/backup.js");
if (process.env.NODE_ENV !== "test") throw Error("Gunakan database uji.");

test("email SMTP: OAuth dihapus, konfigurasi aman dan backup lama dibersihkan", async (t) => {
  const server = app.listen(3187, "127.0.0.1"); await new Promise(r => server.once("listening", r));
  const browser = await chromium.launch({ headless: true }), context = await browser.newContext();
  const origin = process.env.APP_ORIGIN;
  const token = (await (await context.request.get(origin + "/api/csrf")).json()).token;
  const headers = { "X-CSRF-Token": token };
  const before = await settings();
  const put = (data) => context.request.put(origin + "/api/admin/settings", { headers, data });
  const write = (key, value) => db.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
  const smtpFields = async () => db.setting.findMany({ where: { key: { startsWith: "smtp_" } }, orderBy: { key: "asc" } });
  try {
    assert.equal((await context.request.post(origin + "/api/auth/login", { headers, data: { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD } })).status(), 200);
    await t.test("endpoint login/config/status/callback lama tidak lagi dapat digunakan", async () => {
      for (const provider of ["gmail", "outlook"]) {
        assert.equal((await context.request.post(origin + `/api/admin/mail/oauth/${provider}/start`, { headers, data: {} })).status(), 410);
        assert.equal((await context.request.put(origin + `/api/admin/mail/config/${provider}`, { headers, data: { clientId: "test", clientSecret: "test" } })).status(), 410);
        const callback = await context.request.get(origin + `/api/email/oauth/${provider}/callback?state=old&code=old`, { maxRedirects: 0 });
        assert.equal(callback.status(), 410); assert.equal(callback.headers().location, undefined);
        assert.equal((await put({ email_transport: provider })).status(), 422);
      }
      assert.equal((await context.request.get(origin + "/api/admin/mail/status")).status(), 410);
    });
    await t.test("Settings hanya menawarkan SMTP/nonaktif, pengirim dapat diedit dan placeholder tetap ada", async () => {
      const page = await context.newPage(), errors = [];
      page.on("pageerror", e => errors.push(e.message));
      await page.goto(origin + "/admin/settings?tab=email");
      const method = page.getByLabel("Metode pengiriman email", { exact: true }); await method.waitFor();
      assert.deepEqual(await method.locator("option").evaluateAll(nodes => nodes.map(n => n.value)), ["smtp", "none"]);
      assert.equal(await page.getByRole("button", { name: /Login Gmail|Login Outlook|Hubungkan ulang/ }).count(), 0);
      assert.equal(await page.getByText("Konfigurasi OAuth", { exact: true }).count(), 0);
      assert.equal(await page.getByLabel("Email pengirim", { exact: true }).getAttribute("readonly"), null);
      await method.selectOption("none"); await page.getByLabel("Host SMTP", { exact: true }).waitFor();
      await page.getByRole("button", { name: "Pratinjau email", exact: true }).waitFor();
      await page.setViewportSize({ width: 390, height: 844 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      assert.deepEqual(errors, []); await page.close();
    });
    await t.test("SMTP dan password terenkripsi tetap dapat disimpan tanpa aturan pengirim OAuth", async () => {
      assert.equal((await put({ email_transport: "smtp", smtp_host: "smtp.example.test", smtp_port: 587, smtp_user: "sender@example.test", smtp_password: "SMTP_ONLY_FAKE_SECRET", email_pengirim: "sender@example.test" })).status(), 200);
      const s = await settings(); assert.notEqual(s.smtp_password, "SMTP_ONLY_FAKE_SECRET");
      const visible = await (await context.request.get(origin + "/api/admin/settings")).json();
      assert.equal(visible.smtp_password_set, true); assert.equal(visible.smtp_password, undefined);
      assert.equal(JSON.stringify(visible).includes("SMTP_ONLY_FAKE_SECRET"), false);
      assert.equal((await put({ email_pengirim: "other@example.test", smtp_password: "" })).status(), 200);
      assert.equal((await settings()).smtp_password, s.smtp_password);
    });
    await t.test("SMTP simulasi berhasil; nonaktif dan metode lama tidak beralih ke SMTP diam-diam", async () => {
      let sent = 0;
      const req = { ip: "127.0.0.1", headers: {} }, transport = { sendMail: async m => { sent++; assert.equal(m.from, "other@example.test"); } };
      await sendMail({ req, recipient: "test@example.com", transport }); assert.equal(sent, 1);
      for (const method of ["none", "gmail", "outlook"]) {
        await write("email_transport", method);
        await assert.rejects(sendMail({ req, recipient: "test@example.com", transport }), /Pengiriman gagal/);
        assert.equal(sent, 1);
      }
      const log = await db.emailLog.findFirst({ where: { recipient: "test@example.com", status: "gagal" }, orderBy: { createdAt: "desc" } });
      assert.match(log.error, /tidak aktif/);
    });
    await t.test("pembersihan idempoten menghapus kredensial/token lama dan mempertahankan SMTP", async () => {
      const originalSmtp = await smtpFields();
      for (const key of ["config_gmail", "connection_outlook", "flow_old", "lock_gmail"]) await write("mail_oauth_" + key, encrypt("REMOVED_FAKE_TOKEN").toString("base64"));
      const visible = await (await context.request.get(origin + "/api/admin/settings")).json();
      assert.equal(visible.email_transport, "none"); assert.ok(!JSON.stringify(visible).includes("mail_oauth_"));
      const first = await db.$transaction(tx => removeDeprecatedMailSettings(tx));
      assert.equal(first.removedSettings, 4); assert.equal(first.transportDisabled, true);
      assert.equal(await db.setting.count({ where: { key: { startsWith: "mail_oauth_" } } }), 0);
      assert.deepEqual(await smtpFields(), originalSmtp);
      const second = await db.$transaction(tx => removeDeprecatedMailSettings(tx));
      assert.deepEqual(second, { removedSettings: 0, transportDisabled: false });
      assert.equal(JSON.stringify(await db.activityLog.findMany()).includes("REMOVED_FAKE_TOKEN"), false);
    });
    await t.test("restore arsip lama tidak menghidupkan koneksi OAuth kembali", async () => {
      const admin = await db.admin.findUnique({ where: { email: process.env.ADMIN_EMAIL } });
      const req = { admin, ip: "127.0.0.1", headers: {} };
      const originalSmtp = await smtpFields();
      await write("email_transport", "gmail"); await write("mail_oauth_connection_gmail", encrypt("OLD_BACKUP_FAKE_TOKEN").toString("base64"));
      const backup = await createBackup(req);
      await db.$transaction(tx => removeDeprecatedMailSettings(tx));
      await restoreBackup(backup.id, req);
      assert.equal((await settings()).email_transport, "none");
      assert.equal(await db.setting.count({ where: { key: { startsWith: "mail_oauth_" } } }), 0);
      assert.deepEqual(await smtpFields(), originalSmtp);
    });
  } finally {
    for (const key of ["email_transport", "email_pengirim", "smtp_host", "smtp_port", "smtp_user", "smtp_password"]) {
      if (Object.hasOwn(before, key)) await write(key, before[key]); else await db.setting.deleteMany({ where: { key } });
    }
    await db.$transaction(tx => removeDeprecatedMailSettings(tx));
    await browser.close(); await closeBrowser(); await new Promise(r => server.close(r)); await db.$disconnect();
  }
});
