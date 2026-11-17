import { test, after } from "node:test";
import assert from "node:assert/strict";
import { documentTemplate } from "../prisma/document-templates.js";
import { renderHtml, cleanHtml, db } from "../server/core.js";
import { documentFor, pdfBuffer, sendMail, closeBrowser } from "../server/documents.js";
after(async () => { await closeBrowser(); await db.$disconnect(); });

test("nomor/tahun buku berasal dari metadata master, bukan jawaban vendor", () => {
  const template = "<p>{{nomor_buku}} / {{tahun_buku}} / {{tahun}}</p>";
  assert.equal(renderHtml(template, { nomor_buku: 999, tahun_buku: 2099 }, "REF", {}, 2032,
    { bookNumber: 42, bookYear: 2031 }), "<!DOCTYPE html>\n<p>42 / 2031 / 2032</p>");
  assert.equal(renderHtml(template, { nomor_buku: 999 }, "REF", {}, 2032), "<!DOCTYPE html>\n<p>- / - / 2032</p>");
});

test("dokumen HTML, PDF dan lampiran email memakai metadata buku master", async () => {
  const template = await db.templateVersion.create({ data: {
    mode: "eksternal", author: "uji-placeholder", html: "<p>Buku {{nomor_buku}} / {{tahun_buku}}</p>",
  } });
  const sub = { id: "uji-placeholder-buku", mode: "eksternal", reference: "UJI-BUKU",
    templateVersionId: template.id, documentSettings: { zona_waktu: "Asia/Jakarta" },
    submittedAt: new Date("2032-01-02T00:00:00Z"), bookNumber: 42, bookYear: 2031,
    values: { nomor_buku: 999, tahun_buku: 2099 } };
  const html = await documentFor(sub);
  assert.equal(html, "<!DOCTYPE html>\n<p>Buku 42 / 2031</p>");
  assert.equal((await pdfBuffer(html)).subarray(0, 4).toString(), "%PDF");
  let message;
  await sendMail({ recipient: "test@example.com", sub,
    req: { mode: "eksternal", ip: "127.0.0.1", headers: {} },
    transport: { sendMail: async (value) => { message = value; } } });
  assert.equal(message.attachments.length, 1);
  assert.equal(message.attachments[0].content.subarray(0, 4).toString(), "%PDF");
});
test("template pengguna mempertahankan CSS A4 dan perbedaan konten kedua mode", () => {
  for (const mode of ["internal", "eksternal"]) {
    const template = documentTemplate(mode),
      clean = cleanHtml(template, true);
    assert.ok(!template.includes("@{"));
    assert.match(clean, /^<!DOCTYPE html>/);
    assert.match(clean, /height: 297mm/);
    assert.match(clean, /grid-template-columns: repeat\(4, 1fr\)/);
    assert.match(clean, /display:\s*inline-block/);
    assert.match(clean, /min-width:\s*150px/);
    assert.equal(clean.includes("Sub Vendor - 4"), mode === "eksternal");
    assert.equal(clean.includes("Received Date by FAA"), mode === "eksternal");
    assert.equal(clean.includes("Received by,"), mode === "eksternal");
    assert.equal(clean.includes("Jl. Rawa Kepiting"), mode === "eksternal");
  }
});
test("placeholder template baru memakai nilai server, escape HTML, helper tanggal/angka dan tahun dinamis", () => {
  const html = renderHtml(
    documentTemplate("eksternal"),
    {
      received_from: "<script>alert(1)</script>",
      invoice_date: "2034-01-02",
      amount_nett: 100,
      vat: 11,
      total: 999,
      currency: "IDR",
    },
    "ROI-EKS-2034-000001",
    { penerima_nama: "Penerima Uji", kode_form: "FM.TEST" },
    2034,
  );
  assert.ok(!html.includes("<script>"));
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /111,00/);
  assert.ok(!html.includes("999,00"));
  assert.match(html, /02-01-2034/);
  assert.match(html, /Penerima Uji/);
  assert.match(html, /FM.TEST/);
  assert.ok(!html.includes("2026"));
  const empty = renderHtml(
    documentTemplate("internal"),
    {},
    "ROI-INT-2034-1",
    {},
    2034,
  );
  assert.match(empty, /Date: -/);
  assert.match(empty, /0,00/);
});

test("template hanya membaca setting dokumen, bukan kredensial atau token", () => {
  const html = renderHtml(
    "<p>{{setting.penerima_nama}} | {{setting.kode_form}} | {{setting.smtp_password}} | {{setting.mail_oauth_connection_gmail}} | {{setting.smtp_user}}</p>",
    {},
    "TEST",
    {
      penerima_nama: "Penerima Uji",
      kode_form: "FM-UJI",
      smtp_password: "AUDIT_FAKE_PASSWORD",
      mail_oauth_connection_gmail: "AUDIT_FAKE_TOKEN",
      smtp_user: "AUDIT_PRIVATE_USER",
    },
    2026,
  );
  assert.match(html, /Penerima Uji/);
  assert.match(html, /FM-UJI/);
  for (const secret of [
    "AUDIT_FAKE_PASSWORD",
    "AUDIT_FAKE_TOKEN",
    "AUDIT_PRIVATE_USER",
  ])
    assert.ok(!html.includes(secret));
});
