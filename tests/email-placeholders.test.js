import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { chromium } from "playwright";
import { db, settings, templateData } from "../server/core.js";
import { emailContent } from "../server/email-template.js";
import { sendMail, closeBrowser } from "../server/documents.js";
import { renderEmailText, validateEmailTemplate } from "../shared/email-placeholders.js";

if (process.env.NODE_ENV !== "test") throw Error("Gunakan database uji.");
process.env.APP_ORIGIN = "http://127.0.0.1:3199";
const { app } = await import("../server/app.js");

test("placeholder email: data master, validasi, pratinjau dan pengiriman simulasi", async (t) => {
  const server = app.listen(3199, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const original = await settings();
  const admin = request.agent(server), csrf = (await admin.get("/api/csrf")).body.token;
  let browser;
  const save = (body) => admin.put("/api/admin/settings").set("X-CSRF-Token", csrf).send(body);
  const sub = {
    id: "test-email-placeholders", mode: "internal", reference: "ROI-INT-2032-000123",
    bookNumber: 42, bookYear: 2031, submittedAt: new Date("2032-01-02T00:00:00Z"),
    documentSettings: { zona_waktu: "Asia/Jakarta", penerima_nama: "Nama Saat Submit", kode_form: "FM-UJI" },
    values: { received_from: "PT A & B <Vendor>", invoice_number: "INV-123", invoice_date: "2031-12-31",
      amount_nett: "100.10", vat: "11.01", currency: "USD", nomor_buku: 999, tahun_buku: 2099,
      nomor_referensi: "PALSU", total: 9999, setting: { smtp_password: "PALSU" },
      kustom: ["A", "B"], catatan: "{{setting.smtp_password}}" },
  };
  try {
    await admin.post("/api/auth/login").set("X-CSRF-Token", csrf).send({ email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD }).expect(200);
    await admin.post("/api/admin/mode").set("X-CSRF-Token", csrf).send({ mode: "internal" }).expect(200);
    await t.test("kedua mode menggunakan nomor/tahun master, total server dan setting saat submit", () => {
      for (const mode of ["internal", "eksternal"]) {
        const result = emailContent({
          email_subjek: "Buku {{nomor_buku}} / {{tahun_buku}} — {{nomor_referensi}}",
          email_isi: "{{received_from}}\n{{format_date invoice_date 'dd-MM-yyyy'}}: {{currency}} {{format_number total}}\n{{tahun}} | {{setting.penerima_nama}} | {{kustom}} | {{tidak_ada}}",
        }, { ...sub, mode });
        assert.equal(result.subject, "Buku 42 / 2031 — ROI-INT-2032-000123");
        assert.equal(result.text, "PT A & B <Vendor>\n31-12-2031: USD 111,11\n2032 | Nama Saat Submit | A, B | ");
      }
    });
    await t.test("teks biasa tetap utuh, nilai tidak dievaluasi ulang, CRLF subjek dibersihkan", () => {
      const data = templateData(sub.values, sub.reference, { smtp_password: "RAHASIA", mail_oauth_config_gmail: "TOKEN" }, 2032, sub);
      assert.equal(renderEmailText("{{catatan}}", data), "{{setting.smtp_password}}");
      assert.equal(renderEmailText("{{received_from}}", data), "PT A & B <Vendor>");
      assert.equal(renderEmailText("Invoice {{injeksi}}", { injeksi: "A\r\nBcc: user@example.com\u0000" }, { subject: true }), "Invoice A Bcc: user@example.com");
      assert.equal(renderEmailText("{{nomor_buku}} / {{tahun_buku}} / {{format_number vat}} / {{format_date invoice_date 'dd-MM-yyyy'}}",
        templateData({}, "R", {}, 2032)), "- / - / 0,00 / -");
      assert.throws(() => renderEmailText("{{nama}}".repeat(100), { nama: "a".repeat(10000) }), /terlalu panjang/);
    });
    await t.test("syntax terlarang dan akses rahasia ditolak tanpa perubahan settings", async () => {
      for (const value of ["{{{received_from}}}", "{{#if nomor_buku}}x{{/if}}", "{{setting.smtp_password}}", "{{setting.mail_oauth_config_gmail}}", "{{received_from.constructor}}", "{{constructor}}", "{{format_date invoice_date}}", "{{nomor_buku", "{{& received_from}}"] ) {
        assert.throws(() => validateEmailTemplate(value), /Placeholder email tidak valid/);
        await save({ email_subjek: value }).expect(422);
        await save({ email_isi: value }).expect(422);
      }
      assert.equal((await settings()).email_subjek, original.email_subjek);
      assert.equal((await settings()).email_isi, original.email_isi);
      await admin.put("/api/admin/settings").send({ email_subjek: "{{nomor_buku}}" }).expect(403);
    });
    await t.test("pratinjau draf tidak menyimpan settings atau mengirim email", async () => {
      const logs = await db.emailLog.count();
      const result = await admin.post("/api/admin/settings/preview-email").set("X-CSRF-Token", csrf).send({
        email_subjek: "Buku {{nomor_buku}} / {{tahun_buku}}", email_isi: "{{received_from}}: {{format_number total}}",
      }).expect(200);
      assert.match(result.body.subject, /^Buku 1 \/ \d{4}$/);
      assert.equal(result.body.text, "PT Contoh Vendor: 1.110.000,00");
      assert.equal(await db.emailLog.count(), logs);
      assert.equal((await settings()).email_subjek, original.email_subjek);
      await admin.post("/api/admin/settings/preview-email").set("X-CSRF-Token", csrf).send({ email_subjek: "{{setting.smtp_password}}", email_isi: "x" }).expect(422);
      await request(server).post("/api/admin/settings/preview-email").send({}).expect(403);
    });
    await t.test("subjek dan isi dirender pada email dengan lampiran PDF; teks lama tetap kompatibel", async () => {
      await save({ email_transport: "smtp", email_subjek: "ROI {{nomor_buku}} / {{tahun_buku}}", email_isi: "{{received_from}} — {{format_number total}}" }).expect(200);
      sub.templateVersionId = (await db.templateVersion.create({ data: { mode: "internal", author: "test-email", html: "<p>{{nomor_buku}}</p>" } })).id;
      let captured;
      const transport = { sendMail: async (message) => { captured = message; } };
      const req = { mode: "internal", ip: "127.0.0.1", headers: {} };
      await sendMail({ recipient: "test@example.com", sub, req, transport });
      assert.equal(captured.subject, "ROI 42 / 2031");
      assert.equal(captured.text, "PT A & B <Vendor> — 111,11");
      assert.equal(captured.attachments[0].content.subarray(0, 4).toString(), "%PDF");
      await save({ email_subjek: "Receipt of Invoice", email_isi: "Cetak 2 rangkap.\nTerima kasih." }).expect(200);
      await sendMail({ recipient: "test@example.com", sub, req, transport });
      assert.equal(captured.subject, "Receipt of Invoice");
      assert.equal(captured.text, "Cetak 2 rangkap.\nTerima kasih.");
      await sendMail({ recipient: "test@example.com", req, transport });
      assert.equal(captured.subject, "Tes email ROI BCU");
      assert.equal(captured.attachments.length, 0);
    });
    await t.test("Settings menampilkan daftar dan pratinjau dari teks yang belum disimpan", async () => {
      browser = await chromium.launch({ headless: true });
      const context = await browser.newContext(), origin = `http://127.0.0.1:${server.address().port}`;
      const token = (await (await context.request.get(origin + "/api/csrf")).json()).token;
      const headers = { "X-CSRF-Token": token };
      await context.request.post(origin + "/api/auth/login", { headers, data: { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD } });
      await context.request.post(origin + "/api/admin/mode", { headers, data: { mode: "internal" } });
      const page = await context.newPage(), errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(origin + "/admin");
      await page.locator(".sidebar nav").getByRole("link", { name: /Settings/ }).click();
      await page.getByRole("button", { name: "Email / SMTP", exact: true }).click();
      await page.getByLabel("Subjek email", { exact: true }).fill("Buku {{nomor_buku}} / {{tahun_buku}}");
      await page.getByLabel("Isi email", { exact: true }).fill("Halo {{received_from}}\nTotal {{format_number total}}");
      await page.getByText("Daftar placeholder email", { exact: true }).click();
      assert.equal(await page.getByRole("button", { name: "{{nomor_buku}}", exact: true }).getAttribute("type"), "button");
      const response = page.waitForResponse((r) => r.url().endsWith("/api/admin/settings/preview-email"));
      await page.getByRole("button", { name: "Pratinjau email", exact: true }).click();
      assert.equal((await response).status(), 200);
      const preview = page.getByRole("region", { name: "Pratinjau email" });
      await preview.waitFor();
      assert.match(await preview.innerText(), /Halo PT Contoh Vendor\nTotal 1.110.000,00/);
      await page.getByLabel("Subjek email", { exact: true }).fill("Judul berubah");
      await preview.waitFor({ state: "detached" });
      assert.equal((await settings()).email_subjek, "Receipt of Invoice");
      assert.deepEqual(errors, []);
      await context.close();
    });
  } finally {
    if (browser) await browser.close();
    for (const key of ["email_transport", "email_subjek", "email_isi"]) await db.setting.upsert({ where: { key }, create: { key, value: original[key] }, update: { value: original[key] } });
    await closeBrowser();
    await new Promise((resolve) => server.close(resolve));
    await db.$disconnect();
  }
});
