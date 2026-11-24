import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import bcrypt from "bcryptjs";
import request from "supertest";
import ExcelJS from "exceljs";
import AdmZip from "adm-zip";
import { app } from "../server/app.js";
import { db, encrypt, decrypt, dataDir } from "../server/core.js";
import { createBackup, restoreBackup, archivePath, backupPath } from "../server/backup.js";
import { reviewState } from "../server/custom-review.js";

if (process.env.NODE_ENV !== "test") throw Error("Gunakan database uji terpisah");

test("review tabel kustom: validasi, konflik, query, riwayat, ekspor dan backup", async (t) => {
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const admin = request.agent(server), other = request.agent(server), reader = request.agent(server);
  let csrf, oc, rc, column, rows, external, source;
  const post = (url, body) => admin.post(url).set("X-CSRF-Token", csrf).send(body);
  const patch = (id, body, agent = admin, token = csrf) => agent.patch("/api/admin/custom/rows/" + id).set("X-CSRF-Token", token).send(body);
  const page = (query = {}) => admin.get("/api/admin/custom").query({ year: 2096, ...query });
  const history = async () => (await admin.get("/api/admin/custom/history").expect(200)).body;
  const travel = async (direction) => post("/api/admin/custom/" + direction, { expectedId: (await history())[direction + "Id"] }).expect(200);
  const fetchRow = (row) => db.customRow.findUnique({ where: { id: row.id } });
  const update = async (row, values, agent = admin, token = csrf) => {
    const before = await fetchRow(row);
    return patch(row.id, { ...values, expectedBookYear: before.bookYear,
      expectedReview: Object.fromEntries(Object.keys(values).filter((key) => key.startsWith("review")).map((key) => [key, before[key]])) }, agent, token).expect(200);
  };
  const xlsx = (url) => admin.get(url).buffer(true).parse((res, cb) => {
    const chunks = []; res.on("data", (chunk) => chunks.push(chunk)); res.on("end", () => cb(null, Buffer.concat(chunks)));
  });
  const baseline = await createBackup({ ip: "review-test-baseline" });
  try {
    csrf = (await admin.get("/api/csrf")).body.token;
    await post("/api/auth/login", { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD }).expect(200);
    await post("/api/admin/mode", { mode: "internal" }).expect(200);
    for (const [agent, email, role] of [[other, "review-other@bcupt.id", "admin"], [reader, "review-reader@bcupt.id", "user"]]) {
      await db.admin.create({ data: { name: "Uji Review", email, role, password: await bcrypt.hash("ReviewUji!2026", 4) } });
      const token = (await agent.get("/api/csrf")).body.token;
      await agent.post("/api/auth/login").set("X-CSRF-Token", token).send({ email, password: "ReviewUji!2026" }).expect(200);
      await agent.post("/api/admin/mode").set("X-CSRF-Token", token).send({ mode: "internal" }).expect(200);
      if (agent === other) oc = token; else rc = token;
    }
    const vendor = request.agent(server), vc = (await vendor.get("/api/csrf")).body.token;
    const publicForm = (await vendor.get("/api/public/internal/form").expect(200)).body;
    const emailField = publicForm.form.fields.find((f) => f.code === "email_anda");
    const submitted = (await vendor.post("/api/public/internal/submit").set("X-CSRF-Token", vc).send({
      formVersionId: publicForm.form.id, termsVersionId: publicForm.termsVersionId, termsRevision: publicForm.termsRevision,
      accepted: true, startedAt: new Date().toISOString(), values: {
        paham_ketentuan: "Ya", email_anda: emailField.type === "select" ? emailField.options[0].value : "review@example.test",
        received_from: "PT Uji Review", invoice_number: "REVIEW-MASTER", invoice_date: "2098-01-01", currency: "IDR", amount_nett: "100.20",
        ada_ppn: "Tidak", invoice_jasa: "Tidak", ada_subvendor_1: "Tidak", legalitas_terkirim: "Belum", permintaan_via: "Email", po_number: "PO-REVIEW",
      },
    }).expect(201)).body;
    source = await db.submission.findUnique({ where: { id: submitted.id } });
    column = (await post("/api/admin/custom/columns", { label: "Review fixture", type: "short" }).expect(200)).body;
    rows = [];
    for (let i = 0; i < 4; i++) rows.push((await post("/api/admin/custom/rows", { year: 2096 }).expect(200)).body);
    external = await db.customRow.create({ data: { mode: "eksternal", bookYear: 2096, bookNumber: 998,
      reviewChecked: true, reviewFlag: "problem", reviewNote: "Catatan eksternal rahasia" } });
    for (let i = 0; i < rows.length; i++) await db.customCell.create({ data: {
      mode: "internal", rowId: rows[i].id, columnId: column.id, value: "REVIEW-" + i,
    } });
    const masterBefore = await db.submission.findMany({ orderBy: { id: "asc" } });
    const valuesBefore = await db.submissionValue.findMany({ orderBy: { id: "asc" } });

    await t.test("nilai default serta boolean respons konsisten", async () => {
      const list = (await page().expect(200)).body;
      assert.equal(list.total, 4);
      assert.deepEqual(list.reviewProgress, { total: 4, checked: 0, flagged: 0, noted: 0 });
      assert.deepEqual(reviewState(list.rows[0]), { reviewChecked: false, reviewFlag: null, reviewNote: null });
      assert.equal(typeof list.rows[0].reviewChecked, "boolean");
    });
    await t.test("validasi ketat, batas catatan, autentikasi, CSRF, role dan mode", async () => {
      const id = rows[0].id;
      for (const body of [{}, { reviewChecked: "true" }, { reviewFlag: "ok" }, { reviewFlag: "invalid" },
        { reviewNote: "x".repeat(2001) }, { reviewNote: 1 }, { reviewChecked: true },
        { reviewChecked: true, expectedReview: { reviewChecked: false }, masterId: "berbahaya" }])
        await patch(id, body).expect(422);
      await request(server).get("/api/admin/custom").expect(401);
      await admin.patch("/api/admin/custom/rows/" + id).send({ reviewChecked: true }).expect(403);
      await patch(id, { reviewChecked: true, expectedReview: { reviewChecked: false } }, reader, rc).expect(403);
      await patch(external.id, { reviewChecked: false, expectedReview: { reviewChecked: true } }).expect(404);
      await admin.get("/api/admin/custom").query({ year: 2096, review: "' OR 1=1 --" }).expect(422);
      await admin.get("/api/admin/custom").query({ review: ["flagged", "noted"] }).expect(422);
      await update(rows[2], { reviewNote: "é".repeat(2000) });
      assert.equal((await fetchRow(rows[2])).reviewNote.length, 2000);
      await update(rows[2], { reviewNote: null });
    });
    await t.test("ubah field parsial, audit dan Undo/Redo tiga field review", async () => {
      await update(rows[0], { reviewChecked: true }); assert.equal((await history()).undoLabel, "Tandai dicek");
      await update(rows[0], { reviewFlag: "followup" }); assert.equal((await history()).undoLabel, "Ubah penanda");
      await update(rows[0], { reviewNote: "Periksa faktur pajak" }); assert.equal((await history()).undoLabel, "Ubah catatan");
      assert.deepEqual(reviewState(await fetchRow(rows[0])), { reviewChecked: true, reviewFlag: "followup", reviewNote: "Periksa faktur pajak" });
      await travel("undo"); assert.equal((await fetchRow(rows[0])).reviewNote, null);
      await travel("undo"); assert.equal((await fetchRow(rows[0])).reviewFlag, null);
      await travel("undo"); assert.equal((await fetchRow(rows[0])).reviewChecked, false);
      for (let i = 0; i < 3; i++) await travel("redo");
      await patch(rows[0].id, { color: "#fff0bb" }).expect(200);
      assert.equal((await fetchRow(rows[0])).reviewNote, "Periksa faktur pajak");
      const log = await db.activityLog.findFirst({ where: { action: "custom.row.review", mode: "internal" }, orderBy: { createdAt: "desc" } });
      assert.ok(log.before[0].value.id === rows[0].id);
      assert.ok(log.after[0].value.reviewNote === "Periksa faktur pajak");
    });
    await t.test("dua admin: konflik mempertahankan data, menimpa dengan pembanding terbaru atau memuat ulang", async () => {
      const initial = (await fetchRow(rows[0])).reviewNote, draft = "Draf lokal saya";
      await update(rows[0], { reviewNote: "Catatan admin lain" }, other, oc);
      const before = await history();
      const conflict = (await patch(rows[0].id, { reviewNote: draft, expectedReview: { reviewNote: initial } }).expect(409)).body;
      assert.equal(conflict.details.code, "CUSTOM_REVIEW_CONFLICT");
      assert.equal(conflict.details.rowId, rows[0].id);
      assert.equal(conflict.details.current.reviewNote, "Catatan admin lain");
      assert.deepEqual(await history(), before);
      // Reload reads the other admin's value. A deliberate overwrite submits the retained draft and latest comparison.
      assert.equal((await page().expect(200)).body.rows.find((r) => r.id === rows[0].id).reviewNote, "Catatan admin lain");
      await patch(rows[0].id, { reviewNote: draft, expectedReview: { reviewNote: conflict.details.current.reviewNote } }).expect(200);
      await update(rows[0], { reviewChecked: false }, other, oc);
      await patch(rows[0].id, { reviewNote: "Catatan akhir", expectedReview: { reviewNote: draft } }).expect(200);
      assert.equal((await fetchRow(rows[0])).reviewChecked, false, "edit catatan tidak menimpa checkbox admin lain");
      await travel("undo"); assert.equal((await fetchRow(rows[0])).reviewNote, draft);
      assert.equal((await fetchRow(rows[0])).reviewChecked, false);
      await travel("redo");
    });
    await t.test("permintaan review lama ditolak setelah baris pindah tahun buku", async () => {
      const date = (await post("/api/admin/custom/columns", { label: "Tanggal review", type: "date" }).expect(200)).body;
      // invoice_date drives the existing custom-only year transition.
      const invoiceDate = await db.customColumn.findFirst({ where: { mode: "internal", code: "invoice_date" } })
        || await db.customColumn.update({ where: { id: date.id }, data: { code: "invoice_date" } });
      await admin.put("/api/admin/custom/cell").set("X-CSRF-Token", csrf).send({ rowId: rows[3].id, columnId: invoiceDate.id, value: "2097-01-01" }).expect(200);
      const delayed = (await patch(rows[3].id, { reviewNote: "Draf dari tahun lama", expectedBookYear: 2096,
        expectedReview: { reviewNote: null } }).expect(409)).body;
      assert.equal(delayed.details.code, "CUSTOM_ROW_MOVED"); assert.equal(delayed.details.bookYear, 2097);
      assert.equal((await fetchRow(rows[3])).reviewNote, null);
      await travel("undo"); assert.equal((await fetchRow(rows[3])).bookYear, 2096);
    });
    await t.test("simpan serentak dari dua admin hanya menerima satu nilai pembanding yang sama", async () => {
      const body = (reviewNote) => ({ reviewNote, expectedReview: { reviewNote: null } });
      const results = await Promise.all([
        patch(rows[2].id, body("Draf A")), patch(rows[2].id, body("Draf B"), other, oc),
      ]);
      assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
      assert.ok(["Draf A", "Draf B"].includes((await fetchRow(rows[2])).reviewNote));
      assert.equal(results.find((r) => r.status === 409).body.details.code, "CUSTOM_REVIEW_CONFLICT");
      await update(rows[2], { reviewNote: null });
    });
    await t.test("filter, pencarian, tahun, sorting, pagination dan progres tahunan", async () => {
      await update(rows[0], { reviewChecked: true, reviewFlag: "followup", reviewNote: "Catatan akhir" });
      await update(rows[1], { reviewFlag: "problem", reviewNote: "Perlu koreksi" });
      await update(rows[2], { reviewChecked: true, reviewNote: "   \n\t " });
      assert.equal((await fetchRow(rows[2])).reviewNote, null);
      const progress = { total: 4, checked: 2, flagged: 2, noted: 2 };
      for (const [review, expected] of [["unchecked", 2], ["flagged", 2], ["noted", 2], ["problem", 1]]) {
        const list = (await page({ review, size: 1, page: 2, sort: column.id, dir: "desc" }).expect(200)).body;
        assert.equal(list.total, expected); assert.equal(list.rows.length, 1);
        assert.deepEqual(list.reviewProgress, progress);
        const rowIds = new Set(list.rows.map((r) => r.id)); assert.ok(list.cells.every((c) => rowIds.has(c.rowId)));
      }
      const none = (await page({ q: "TIDAK-ADA", review: "problem" }).expect(200)).body;
      assert.equal(none.total, 0); assert.deepEqual(none.reviewProgress, progress);
      const one = (await page({ q: "REVIEW-1", review: "problem" }).expect(200)).body;
      assert.equal(one.rows[0].id, rows[1].id);
      assert.deepEqual((await page({ year: 2099 }).expect(200)).body.reviewProgress, { total: 0, checked: 0, flagged: 0, noted: 0 });
      assert.equal((await page({ year: "all", review: "problem" }).expect(200)).body.rows.some((r) => r.id === external.id), false);
    });
    await t.test("ekspor review mengikuti filter lintas halaman dan aman terhadap formula", async () => {
      await update(rows[1], { reviewNote: "=HYPERLINK(\"berbahaya\")" });
      const query = "?year=2096&review=flagged&q=REVIEW-&size=1&page=2";
      const csv = await admin.get("/api/admin/custom/export/csv" + query).expect(200);
      assert.match(csv.text, /"Dicek","Penanda","Catatan"/);
      assert.match(csv.text, /Tindak lanjut/); assert.match(csv.text, /Bermasalah/);
      assert.match(csv.text, /'=HYPERLINK/); assert.ok(!csv.text.includes("REVIEW-2"));
      const book = new ExcelJS.Workbook(); await book.xlsx.load((await xlsx("/api/admin/custom/export/xlsx" + query).expect(200)).body);
      const sheet = book.worksheets[0], headers = sheet.getRow(1).values;
      assert.equal(sheet.rowCount, 3);
      assert.equal(sheet.getCell(2, headers.indexOf("Dicek")).value, "Ya");
      assert.equal(sheet.getCell(3, headers.indexOf("Catatan")).value, "'=HYPERLINK(\"berbahaya\")");
    });
    await t.test("sinkronisasi ulang hanya menambah baris, review lama tetap dan master tidak berubah", async () => {
      const before = await Promise.all(rows.map(fetchRow));
      const copied = await db.customRow.findFirst({ where: { mode: "internal", masterId: source.id } });
      assert.deepEqual(reviewState(copied), { reviewChecked: false, reviewFlag: null, reviewNote: null });
      await db.customCell.deleteMany({ where: { rowId: copied.id } });
      await db.customRow.delete({ where: { id: copied.id } });
      const synced = (await post("/api/admin/custom/sync", { confirm: "SINKRONISASI ULANG" }).expect(200)).body;
      assert.equal(synced.added, 1);
      assert.deepEqual(reviewState(await db.customRow.findFirst({ where: { mode: "internal", masterId: source.id } })),
        { reviewChecked: false, reviewFlag: null, reviewNote: null });
      assert.deepEqual(await Promise.all(rows.map(fetchRow)), before);
      assert.deepEqual(await db.submission.findMany({ orderBy: { id: "asc" } }), masterBefore);
      assert.deepEqual(await db.submissionValue.findMany({ orderBy: { id: "asc" } }), valuesBefore);
    });
    await t.test("riwayat lama tanpa review tetap bisa Undo/Redo; review baru mencegah penghapusan tak sengaja", async () => {
      const legacy = (await post("/api/admin/custom/rows", { year: 2096 }).expect(200)).body;
      const adminId = (await db.admin.findUnique({ where: { email: process.env.ADMIN_EMAIL } })).id;
      const state = await db.customHistory.findUnique({ where: { id: "internal:" + adminId } });
      for (const entry of state.undo) for (const change of entry.changes) if (change.id === legacy.id)
        for (const key of ["before", "after"]) if (change[key]) for (const field of ["reviewChecked", "reviewFlag", "reviewNote"]) delete change[key][field];
      await db.customHistory.update({ where: { id: state.id }, data: { undo: state.undo } });
      await travel("undo"); assert.equal(await fetchRow(legacy), null);
      await travel("redo"); assert.deepEqual(reviewState(await fetchRow(legacy)), { reviewChecked: false, reviewFlag: null, reviewNote: null });
      await update(legacy, { reviewNote: "Catatan orang lain" }, other, oc);
      await post("/api/admin/custom/undo", { expectedId: (await history()).undoId }).expect(409);
      assert.equal((await fetchRow(legacy)).reviewNote, "Catatan orang lain");
    });
    await t.test("backup baru menyimpan review dan restore global memulihkannya", async () => {
      const req = { mode: "internal", admin: { email: process.env.ADMIN_EMAIL }, ip: "test" };
      const before = reviewState(await fetchRow(rows[0]));
      const backup = await createBackup(req);
      await update(rows[0], { reviewNote: "Setelah backup" });
      const snapshot = (await admin.get("/api/admin/custom/backups/" + backup.id).expect(200)).body;
      assert.deepEqual(reviewState(snapshot.rows.find((r) => r.id === rows[0].id)), before);
      assert.ok(!JSON.stringify(snapshot).includes("Catatan eksternal rahasia"));
      const csv = await admin.get("/api/admin/custom/backups/" + backup.id + "/export/csv").expect(200);
      assert.match(csv.text, /"Dicek","Penanda","Catatan"/); assert.ok(!csv.text.includes("Setelah backup"));
      await restoreBackup(backup.id, req);
      assert.deepEqual(reviewState(await fetchRow(rows[0])), before);
      assert.equal(await db.customHistory.count(), 0);
      // Restore ends sessions; log in again before examining a legacy snapshot.
      csrf = (await admin.get("/api/csrf")).body.token;
      await post("/api/auth/login", { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD }).expect(200);
      await post("/api/admin/mode", { mode: "internal" }).expect(200);
    });
    await t.test("backup lama tanpa review: pratinjau, ekspor dan restore memakai default", async () => {
      const req = { mode: "internal", admin: { email: process.env.ADMIN_EMAIL }, ip: "test" };
      const backup = await createBackup(req), zip = new AdmZip(decrypt(await fs.readFile(archivePath(backup.filename))));
      const manifest = JSON.parse(zip.readAsText("database.json"));
      for (const row of manifest.tables.customRow) for (const field of ["reviewChecked", "reviewFlag", "reviewNote"]) delete row[field];
      zip.updateFile("database.json", Buffer.from(JSON.stringify(manifest)));
      const file = path.join(await backupPath(), "legacy-review-" + crypto.randomUUID() + ".zip.enc"), bytes = encrypt(zip.toBuffer());
      await fs.writeFile(file, bytes);
      const legacy = await db.backup.create({ data: { filename: path.relative(dataDir, file).replaceAll("\\", "/"), size: bytes.length, status: "selesai" } });
      const snapshot = (await admin.get("/api/admin/custom/backups/" + legacy.id).expect(200)).body;
      assert.deepEqual(reviewState(snapshot.rows.find((r) => r.id === rows[0].id)), { reviewChecked: false, reviewFlag: null, reviewNote: null });
      const book = new ExcelJS.Workbook(); await book.xlsx.load((await xlsx("/api/admin/custom/backups/" + legacy.id + "/export/xlsx").expect(200)).body);
      assert.ok(book.worksheets[0].getRow(1).values.includes("Catatan"));
      await restoreBackup(legacy.id, req);
      assert.deepEqual(reviewState(await fetchRow(rows[0])), { reviewChecked: false, reviewFlag: null, reviewNote: null });
      assert.deepEqual(await db.submission.findMany({ orderBy: { id: "asc" } }), masterBefore);
    });
    await t.test("reset mengosongkan review salinan; sinkronisasi kembali memakai default dan master tetap utuh", async () => {
      csrf = (await admin.get("/api/csrf")).body.token;
      await post("/api/auth/login", { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD }).expect(200);
      await post("/api/admin/mode", { mode: "internal" }).expect(200);
      const copy = await db.customRow.findFirst({ where: { mode: "internal", masterId: source.id } });
      await update(copy, { reviewChecked: true, reviewFlag: "problem", reviewNote: "Akan direset" });
      await post("/api/admin/custom/reset", { confirm: "RESET SALINAN" }).expect(200);
      assert.equal(await db.customRow.count({ where: { mode: "internal" } }), 0);
      await post("/api/admin/custom/sync", { confirm: "SINKRONISASI ULANG" }).expect(200);
      const reset = await db.customRow.findFirst({ where: { mode: "internal", masterId: source.id } });
      assert.deepEqual(reviewState(reset), { reviewChecked: false, reviewFlag: null, reviewNote: null });
      assert.deepEqual(await db.submission.findMany({ orderBy: { id: "asc" } }), masterBefore);
      assert.deepEqual(await db.submissionValue.findMany({ orderBy: { id: "asc" } }), valuesBefore);
    });
  } finally {
    await restoreBackup(baseline.id, { ip: "review-test-cleanup" });
    await new Promise((resolve) => server.close(resolve));
    await db.$disconnect();
  }
});
