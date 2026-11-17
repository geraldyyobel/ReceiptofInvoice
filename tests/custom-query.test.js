import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import request from "supertest";
import ExcelJS from "exceljs";
import { app } from "../server/app.js";
import { db } from "../server/core.js";
import { nextBookNumber, backfillBooks } from "../server/bookkeeping.js";
import { indexCells } from "../shared/table-data.js";
import fs from "node:fs/promises";
import path from "node:path";
import AdmZip from "adm-zip";
import { createBackup, restoreBackup, archivePath, backupPath } from "../server/backup.js";
import { encrypt, decrypt } from "../server/core.js";

if (process.env.NODE_ENV !== "test") throw Error("Gunakan runner database uji terpisah");

test("pagination/pencarian/ekspor server dan pembukuan berdasarkan tanggal invoice", async (t) => {
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const admin = request.agent(server), vendor = request.agent(server);
  const ids = [], submissions = [], columns = [];
  let csrf, vc;
  const post = (url, body) => admin.post(url).set("X-CSRF-Token", csrf).send(body);
  try {
    csrf = (await admin.get("/api/csrf")).body.token;
    vc = (await vendor.get("/api/csrf")).body.token;
    await post("/api/auth/login", { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD }).expect(200);
    const submit = async (mode, date, suffix) => {
      const p = (await vendor.get(`/api/public/${mode}/form`)).body;
      const values = {
        paham_ketentuan: "Ya", email_anda: "books@example.test", received_from: "PT Uji Tahun Buku",
        invoice_number: "BOOK-" + suffix, invoice_date: date, currency: "IDR", amount_nett: "100.20",
        ada_ppn: "Tidak", invoice_jasa: "Tidak", ada_subvendor_1: "Tidak", legalitas_terkirim: "Belum",
        permintaan_via: "Email", po_number: "PO-BOOKS",
      };
      for (const f of p.form.fields) if (f.type === "select" && f.code === "email_anda") values[f.code] = f.options[0].value;
      const r = await vendor.post(`/api/public/${mode}/submit`).set("X-CSRF-Token", vc).send({
        formVersionId: p.form.id, termsVersionId: p.termsVersionId, termsRevision: p.termsRevision,
        accepted: true, startedAt: new Date().toISOString(), values,
      }).expect(201);
      submissions.push(r.body.id);
      return db.submission.findUnique({ where: { id: r.body.id } });
    };
    const firstByMode = {};
    await t.test("tahun invoice menentukan buku, nomor kembali 1 per mode/tahun, referensi/ID tetap unik", async () => {
      for (const mode of ["internal", "eksternal"]) {
        const a = await submit(mode, "2070-12-31", mode + "-A");
        const b = await submit(mode, "2070-01-01", mode + "-B");
        const c = await submit(mode, "2071-01-01", mode + "-C");
        firstByMode[mode] = a;
        assert.deepEqual([a.bookYear, a.bookNumber, b.bookNumber, c.bookYear, c.bookNumber], [2070, 1, 2, 2071, 1]);
        assert.equal(new Set([a.id, b.id, c.id]).size, 3);
        assert.equal(new Set([a.reference, b.reference, c.reference]).size, 3);
        await post("/api/admin/mode", { mode }).expect(200);
        const list = (await admin.get("/api/admin/submissions?year=2070").expect(200)).body;
        assert.equal(list.total, 2);
        assert.ok(list.rows.every((r) => r.bookYear === 2070));
        const copied = await db.customRow.findFirst({ where: { mode, masterId: a.id } });
        assert.deepEqual([copied.bookYear, copied.bookNumber], [2070, 1]);
      }
    });
    await post("/api/admin/mode", { mode: "internal" }).expect(200);
    for (const type of ["short", "number"]) {
      const r = (await post("/api/admin/custom/columns", { label: "Query " + type, type }).expect(200)).body;
      columns.push(r);
    }
    const fixtureRows = [], fixtureCells = [];
    await db.$transaction(async (tx) => {
      for (let i = 0; i < 120; i++) {
        const row = { id: crypto.randomUUID(), mode: "internal", ...(await nextBookNumber(tx, "internal", 2080)) };
        ids.push(row.id); fixtureRows.push(row);
        fixtureCells.push({ mode: "internal", rowId: row.id, columnId: columns[0].id,
          value: `QUERY-LINE-${String(i).padStart(3, "0")}` + (i === 0 ? " %_!" : ""), color: i === 0 ? "#fff0bb" : null });
        if (i !== 119) fixtureCells.push({ mode: "internal", rowId: row.id, columnId: columns[1].id, value: 120 - i });
      }
      await tx.customRow.createMany({ data: fixtureRows });
      await tx.customCell.createMany({ data: fixtureCells });
    });
    await t.test("50 baris per halaman, sel hanya milik halaman, all=1 tetap dibatasi, urutan stabil", async () => {
      const a = (await admin.get("/api/admin/custom?year=2080&all=1").expect(200)).body;
      const b = (await admin.get("/api/admin/custom?year=2080&page=2").expect(200)).body;
      assert.equal(a.total, 120); assert.equal(a.rows.length, 50); assert.equal(b.rows.length, 50);
      assert.ok(!a.rows.some((r) => b.rows.some((s) => r.id === s.id)));
      const pageIds = new Set(a.rows.map((r) => r.id));
      assert.ok(a.cells.every((c) => pageIds.has(c.rowId)));
      assert.deepEqual(a.rows.map((r) => r.bookNumber), Array.from({ length: 50 }, (_, i) => i + 1));
      const tail = (await admin.get("/api/admin/custom?year=2080&page=9999").expect(200)).body;
      assert.equal(tail.page, 3); assert.equal(tail.rows.length, 20);
      assert.ok(a.years.some((y) => y.year === 2080 && y.count === 120));
    });
    await t.test("pencarian lintas halaman, tidak peka kapital, karakter wildcard literal, isolasi mode dan input berbahaya", async () => {
      const one = (await admin.get("/api/admin/custom").query({ year: 2080, q: "query-line-119" }).expect(200)).body;
      assert.equal(one.total, 1); assert.equal(one.rows[0].bookNumber, 120);
      assert.equal((await admin.get("/api/admin/custom").query({ year: 2080, q: "%_!" })).body.total, 1);
      assert.equal((await admin.get("/api/admin/custom").query({ year: 2080, q: "' OR 1=1 --" })).body.total, 0);
      await admin.get("/api/admin/custom").query({ year: "2080 OR 1=1" }).expect(422);
      await admin.get("/api/admin/custom").query({ sort: "id; DROP TABLE custom_rows" }).expect(422);
      await post("/api/admin/mode", { mode: "eksternal" });
      assert.equal((await admin.get("/api/admin/custom?year=2080&q=QUERY-LINE")).body.total, 0);
      await post("/api/admin/mode", { mode: "internal" });
    });
    await t.test("sorting angka dilakukan server sebelum pagination, nilai kosong dan penentu urutan tetap valid", async () => {
      const sorted = (await admin.get("/api/admin/custom").query({ year: 2080, sort: columns[1].id, dir: "asc" }).expect(200)).body;
      assert.equal(sorted.rows[0].bookNumber, 120);
      const cells = indexCells(sorted.cells);
      const numbers = sorted.rows.map((r) => Number(cells.get(r.id)?.get(columns[1].id)?.value || 0));
      assert.deepEqual(numbers, [...numbers].sort((a, b) => a - b));
      const again = (await admin.get("/api/admin/custom").query({ year: 2080, sort: columns[1].id, dir: "asc" })).body;
      assert.deepEqual(again.rows.map((r) => r.id), sorted.rows.map((r) => r.id));
    });
    await t.test("CSV/XLSX mencakup seluruh hasil filter lintas halaman serta warna dan nomor buku", async () => {
      const query = { year: 2080, q: "QUERY-LINE", page: 2, size: 1 };
      const csv = await admin.get("/api/admin/custom/export/csv").query(query).expect(200);
      assert.equal(csv.text.trim().split(/\r?\n/).length, 121);
      assert.match(csv.text, /QUERY-LINE-119/); assert.match(csv.text, /Tahun Buku/);
      assert.ok(!csv.text.includes("PT Uji Tahun Buku"));
      const xlsx = await admin.get("/api/admin/custom/export/xlsx").query(query).buffer(true)
        .parse((res, cb) => { const chunks = []; res.on("data", (chunk) => chunks.push(chunk)); res.on("end", () => cb(null, Buffer.concat(chunks))); }).expect(200);
      const book = new ExcelJS.Workbook(); await book.xlsx.load(xlsx.body);
      const sheet = book.worksheets[0]; assert.equal(sheet.rowCount, 121);
      const headers = sheet.getRow(1).values;
      const column = headers.indexOf("Query short"), yearCol = headers.indexOf("Tahun Buku"), numberCol = headers.indexOf("No. Buku");
      assert.equal(sheet.getCell(2, column).fill.fgColor.argb, "FFFFF0BB");
      assert.equal(sheet.getCell(2, yearCol).value, 2080); assert.equal(sheet.getCell(2, numberCol).value, 1);
    });
    await t.test("edit tanggal kustom pindah buku dalam satu langkah Undo/Redo, master tetap utuh", async () => {
      const sub = firstByMode.internal;
      const row = await db.customRow.findFirst({ where: { mode: "internal", masterId: sub.id } });
      const column = await db.customColumn.findUnique({ where: { mode_code: { mode: "internal", code: "invoice_date" } } });
      const changed = (await admin.put("/api/admin/custom/cell").set("X-CSRF-Token", csrf)
        .send({ rowId: row.id, columnId: column.id, value: "2072-01-01" }).expect(200)).body;
      assert.deepEqual([changed.bookRow.bookYear, changed.bookRow.bookNumber], [2072, 1]);
      const history = (await admin.get("/api/admin/custom/history")).body;
      await post("/api/admin/custom/undo", { expectedId: history.undoId }).expect(200);
      const restored = await db.customRow.findUnique({ where: { id: row.id } });
      assert.deepEqual([restored.bookYear, restored.bookNumber], [row.bookYear, row.bookNumber]);
      const redo = (await admin.get("/api/admin/custom/history")).body;
      await post("/api/admin/custom/redo", { expectedId: redo.redoId }).expect(200);
      assert.equal((await db.submission.findUnique({ where: { id: sub.id } })).bookYear, 2070);
      assert.equal((await admin.get("/api/admin/custom?year=2072")).body.total, 1);
      const manual = (await post("/api/admin/custom/rows", { year: 2072 }).expect(200)).body; ids.push(manual.id);
      assert.equal(manual.bookNumber, 2);
      await admin.delete("/api/admin/custom/rows/" + manual.id).set("X-CSRF-Token", csrf).expect(200);
      const next = (await post("/api/admin/custom/rows", { year: 2072 }).expect(200)).body; ids.push(next.id);
      assert.equal(next.bookNumber, 3);
      const cleared = (await admin.put("/api/admin/custom/cell").set("X-CSRF-Token", csrf)
        .send({ rowId: row.id, columnId: column.id, value: "" }).expect(200)).body;
      assert.equal(cleared.bookRow.bookYear, Number(new Intl.DateTimeFormat("en", { year: "numeric", timeZone: "Asia/Jakarta" }).format(sub.submittedAt)));
      assert.equal((await db.submission.findUnique({ where: { id: sub.id } })).values.invoice_date, "2070-12-31");
    });
    await t.test("backfill data lama beserta Undo/Redo, lalu idempoten tanpa mengubah nilai/warna/ID", async () => {
      const original = firstByMode.eksternal;
      const sub = await db.submission.create({ data: {
        ...original, id: crypto.randomUUID(), reference: "LEGACY-" + crypto.randomUUID(),
        bookYear: null, bookNumber: null, values: { ...original.values, invoice_date: "2068-11-01" },
      } });
      submissions.push(sub.id);
      const row = await db.customRow.create({ data: { mode: "eksternal", masterId: sub.id, color: "#dff1e5" } });
      const snapshot = JSON.parse(JSON.stringify(row)); delete snapshot.bookYear; delete snapshot.bookNumber;
      await db.customHistory.create({ data: {
        id: "legacy-books-history", mode: "eksternal", adminId: "legacy-test",
        undo: [{ id: "old-entry", label: "Tambah baris", changes: [{ table: "customRow", id: row.id, before: null, after: snapshot }] }], redo: [],
      } });
      await db.$transaction(backfillBooks, { timeout: 30000 });
      const migrated = await db.customRow.findUnique({ where: { id: row.id } });
      assert.equal(migrated.id, row.id); assert.equal(migrated.color, row.color);
      assert.equal(migrated.bookYear, 2068); assert.equal(migrated.bookNumber, 1);
      const history = await db.customHistory.findUnique({ where: { id: "legacy-books-history" } });
      assert.deepEqual(history.undo[0].changes[0].after, JSON.parse(JSON.stringify(migrated)));
      const before = await db.customRow.findMany({ where: { id: { in: ids } }, orderBy: { id: "asc" } });
      await db.$transaction(backfillBooks, { timeout: 30000 });
      assert.deepEqual(await db.customRow.findMany({ where: { id: { in: ids } }, orderBy: { id: "asc" } }), before);
    });
    await t.test("restore arsip sebelum fitur tahunan mengisi metadata dan melanjutkan counter tanpa merusak isi", async () => {
      const req = { mode: "internal", admin: { email: "restore-tahun@example.test" }, ip: "test" };
      const backup = await createBackup(req);
      const zip = new AdmZip(decrypt(await fs.readFile(archivePath(backup.filename))));
      const manifest = JSON.parse(zip.readAsText("database.json"));
      for (const model of ["submission", "customRow"]) for (const row of manifest.tables[model]) {
        delete row.bookYear; delete row.bookNumber;
      }
      manifest.tables.counter = manifest.tables.counter.filter((c) => !c.key.startsWith("book:"));
      manifest.tables.setting = manifest.tables.setting.filter((s) => s.key !== "bookkeeping_v1");
      zip.updateFile("database.json", Buffer.from(JSON.stringify(manifest)));
      const dest = path.join(await backupPath(), "legacy-books-" + crypto.randomUUID() + ".zip.enc");
      const bytes = encrypt(zip.toBuffer()); await fs.writeFile(dest, bytes);
      const { dataDir } = await import("../server/core.js");
      const legacy = await db.backup.create({ data: { filename: path.relative(dataDir, dest).replaceAll("\\", "/"), size: bytes.length, status: "selesai" } });
      const before = await db.submission.findUnique({ where: { id: firstByMode.internal.id } });
      await restoreBackup(legacy.id, req);
      const after = await db.submission.findUnique({ where: { id: before.id } });
      assert.equal(after.reference, before.reference); assert.deepEqual(after.values, before.values);
      assert.equal(after.bookYear, 2070); assert.ok(after.bookNumber > 0);
      assert.equal(await db.customRow.count({ where: { OR: [{ bookYear: null }, { bookNumber: null }] } }), 0);
      const maximum = await db.customRow.aggregate({ where: { mode: "internal", bookYear: 2070 }, _max: { bookNumber: true } });
      const next = await db.$transaction((tx) => nextBookNumber(tx, "internal", 2070));
      assert.ok(next.bookNumber > maximum._max.bookNumber);
    });
  } finally {
    const copied = await db.customRow.findMany({ where: { masterId: { in: submissions } }, select: { id: true } });
    const rowIds = [...ids, ...copied.map((r) => r.id)];
    await db.customCell.deleteMany({ where: { rowId: { in: rowIds } } });
    await db.customRow.deleteMany({ where: { id: { in: rowIds } } });
    await db.customColumn.deleteMany({ where: { id: { in: columns.map((c) => c.id) } } });
    await db.submissionValue.deleteMany({ where: { submissionId: { in: submissions } } });
    await db.submission.deleteMany({ where: { id: { in: submissions } } });
    await db.customHistory.deleteMany({ where: { mode: "internal" } });
    await db.customHistory.deleteMany({ where: { id: "legacy-books-history" } });
    await new Promise((resolve) => server.close(resolve)); await db.$disconnect();
  }
});
