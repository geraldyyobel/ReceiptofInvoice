import bcrypt from "bcryptjs";
import ExcelJS from "exceljs";
import { createBackup } from "../server/backup.js";
import { removeHiddenConsent } from "../server/remove-hidden-consent.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import nodemailer from "nodemailer";
import { app } from "../server/app.js";
import {
  db,
  cleanHtml,
  renderHtml,
  settings,
  uploadDir,
} from "../server/core.js";
import { closeBrowser, sendMail } from "../server/documents.js";
import { writeFile, readFile } from "node:fs/promises";
import path from "node:path";
after(async () => {
  await closeBrowser();
  await new Promise((resolve) => server.close(resolve));
  await db.$disconnect();
});
// Keep one listening server for the suite, matching the deployed app lifecycle.
const server = app.listen(0, "127.0.0.1");
before(() =>
  server.listening
    ? undefined
    : new Promise((resolve) => server.once("listening", resolve)),
);
const vendor = request.agent(server),
  admin = request.agent(server);
let vc, ac, sub, form, internalReceipt;
const valid = {
  paham_ketentuan: "Ya",
  email_anda: "vendor@example.com",
  received_from: "PT Vendor <script>alert(1)</script>",
  invoice_number: "INV-001",
  invoice_date: "2026-10-01",
  currency: "IDR",
  amount_nett: "100.10",
  ada_ppn: "Tidak",
  vat: "900",
  invoice_jasa: "Tidak",
  ada_subvendor_1: "Tidak",
  legalitas_terkirim: "Belum",
  permintaan_via: "Email",
  po_number: "PO-001",
};
test("API, keamanan, CRUD, email mock, PDF dan restore end-to-end", async (t) => {
  vc = (await vendor.get("/api/csrf")).body.token;
  ac = (await admin.get("/api/csrf")).body.token;
  const post = (agent, url, body, token = ac) =>
    agent.post(url).set("X-CSRF-Token", token).send(body);
  await t.test("CSRF, login, cookie httpOnly, admin mode", async () => {
    await vendor.post("/api/auth/login").send({}).expect(403);
    await post(admin, "/api/auth/login", {
      email: process.env.ADMIN_EMAIL,
      password: process.env.ADMIN_PASSWORD,
    })
      .expect(200)
      .then((r) => assert.match(r.headers["set-cookie"].join(" "), /HttpOnly/));
    await post(admin, "/api/admin/mode", { mode: "eksternal" }).expect(200);
    await vendor.get("/api/admin/submissions").expect(401);
  });
  const p = (await vendor.get("/api/public/eksternal/form")).body;
  form = p.form;
  const body = {
    formVersionId: form.id,
    termsVersionId: p.termsVersionId,
    termsRevision: p.termsRevision,
    accepted: true,
    startedAt: new Date().toISOString(),
    values: valid,
  };
  await t.test(
    "submit tervalidasi, total server, metadata, nilai tersembunyi hilang",
    async () => {
      await post(
        vendor,
        "/api/public/eksternal/submit",
        { ...body, values: { ...valid, email_anda: "salah" } },
        vc,
      ).expect(422);
      sub = (
        await post(vendor, "/api/public/eksternal/submit", body, vc).expect(201)
      ).body;
      assert.match(sub.reference, /^ROI-EKS-\d{4}-\d{6}$/);
      const row = await db.submission.findUnique({ where: { id: sub.id } });
      assert.equal(row.values.total, 100.1);
      assert.equal(row.values.vat, undefined);
      assert.equal(
        await db.submissionValue.count({
          where: { submissionId: sub.id, code: "vat" },
        }),
        0,
      );
      const second = (
        await post(vendor, "/api/public/eksternal/submit", body, vc).expect(201)
      ).body;
      assert.notEqual(sub.reference, second.reference);
    },
  );
  await t.test("nomor referensi aman untuk submit serentak", async () => {
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        post(vendor, "/api/public/eksternal/submit", body, vc),
      ),
    );
    for (const r of results)
      assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(new Set(results.map((r) => r.body.reference)).size, 6);
  });
  await t.test("pencarian ROI memakai pembukuan master dan memerlukan bukti akses", async () => {
    const url = "/api/public/receipts/lookup";
    const reference = { by: "reference", reference: sub.reference.toLowerCase() };
    const book = { by: "book", mode: "eksternal", bookYear: sub.bookYear, bookNumber: sub.bookNumber };
    const proofs = [{ id: sub.id, token: sub.token }];
    const expected = {
      id: sub.id, reference: sub.reference, mode: "eksternal",
      bookYear: sub.bookYear, bookNumber: sub.bookNumber,
    };
    await vendor.post(url).send({ criteria: reference, proofs }).expect(403);
    for (const criteria of [reference, book]) {
      await post(vendor, url, { criteria, proofs }, vc).expect(200, { found: true, receipt: expected });
      await post(vendor, url, { criteria }, vc).expect(200, { found: true, receipt: null });
    }
    await post(vendor, url, {
      criteria: reference, proofs: [{ id: sub.id, token: "x".repeat(43) }],
    }, vc).expect(200, { found: true, receipt: null });
    await post(vendor, url, {
      criteria: { ...book, mode: "internal" }, proofs,
    }, vc).expect(422);
    const { mode, ...withoutMode } = book;
    await post(vendor, url, { criteria: withoutMode, proofs }, vc).expect(200, { found: true, receipt: expected });
    internalReceipt = await db.submission.create({ data: {
      ...await db.submission.findUniqueOrThrow({ where: { id: sub.id } }),
      id: undefined, reference: "ROI-INT-PRIVATE-LOOKUP", mode: "internal", bookYear: 2194, bookNumber: 1,
    } });
    await post(vendor, url, {
      criteria: { by: "reference", reference: internalReceipt.reference },
      proofs: [{ id: internalReceipt.id, token: sub.token }],
    }, vc).expect(200, { found: false, receipt: null });
    await post(vendor, url, {
      criteria: { ...book, bookYear: sub.bookYear - 1 }, proofs,
    }, vc).expect(200, { found: false, receipt: null });
    await post(vendor, url, {
      criteria: { by: "reference", reference: "ROI-REFERENSI-TIDAK-ADA" },
    }, vc).expect(200, { found: false, receipt: null });
    await post(vendor, url, { criteria: { by: "book", bookNumber: 1 } }, vc).expect(422);
  });
  await t.test("ambil ROI via email hanya mengirim ke alamat penyerahan", async (context) => {
    const url = "/api/public/receipts/email";
    const criteria = { by: "reference", reference: sub.reference };
    const messages = [];
    context.mock.method(nodemailer, "createTransport", () => ({
      async sendMail(message) { messages.push(message); },
    }));
    const oldHost = process.env.SMTP_HOST;
    process.env.SMTP_HOST = "smtp.example.test";
    try {
      await post(vendor, url, { criteria, email: "wrong@example.com" }, vc).expect(202, { ok: true });
      await post(vendor, url, {
        criteria: { ...criteria, reference: "ROI-INVALID" }, email: valid.email_anda,
      }, vc).expect(202, { ok: true });
      assert.equal(messages.length, 0);
      await post(vendor, url, {
        criteria, email: valid.email_anda.toUpperCase(),
      }, vc).expect(202, { ok: true });
      assert.equal(messages.length, 1);
      assert.equal(messages[0].to, valid.email_anda);
      assert.equal(messages[0].attachments[0].filename, sub.reference + ".pdf");
      assert.equal(messages[0].attachments[0].content.subarray(0, 4).toString(), "%PDF");
      await post(vendor, url, {
        criteria: { by: "reference", reference: internalReceipt.reference }, email: valid.email_anda,
      }, vc).expect(202, { ok: true });
      assert.equal(messages.length, 1);
    } finally {
      if (oldHost === undefined) delete process.env.SMTP_HOST;
      else process.env.SMTP_HOST = oldHost;
      await db.submission.delete({ where: { id: internalReceipt.id } });
    }
  });
  await t.test(
    "otorisasi Admin biasa tidak dapat mengubah Settings atau akun",
    async () => {
      await post(admin, "/api/admin/admins", {
        name: "Admin Uji",
        email: "biasa@bcupt.id",
        role: "admin",
        active: true,
        password: "PasswordUji!2026",
      }).expect(200);
      const ordinary = request.agent(server),
        csrf = (await ordinary.get("/api/csrf")).body.token;
      await post(
        ordinary,
        "/api/auth/login",
        { email: "biasa@bcupt.id", password: "PasswordUji!2026" },
        csrf,
      ).expect(200);
      await post(
        ordinary,
        "/api/admin/mode",
        { mode: "eksternal" },
        csrf,
      ).expect(200);
      await ordinary.get("/api/admin/submissions").expect(200);
      await db.setting.create({
        data: { key: "security_probe", value: "AUDIT_PRIVATE_SETTING" },
      });
      try {
        const preview = await ordinary
          .post("/api/admin/template/preview/html")
          .set("X-CSRF-Token", csrf)
          .send({
            html: "<p>{{setting.security_probe}} | {{setting.penerima_nama}}</p>",
            values: {},
          })
          .expect(200);
        assert.ok(!preview.text.includes("AUDIT_PRIVATE_SETTING"));
        const bookPreview = (values) => ordinary.post("/api/admin/template/preview/html")
          .set("X-CSRF-Token", csrf)
          .send({ html: "<p>{{nomor_buku}} / {{tahun_buku}}</p>", values });
        assert.equal((await bookPreview({ invoice_date: "2031-12-31" }).expect(200)).text,
          "<!DOCTYPE html>\n<p>1 / 2031</p>");
        assert.equal((await bookPreview({ nomor_buku: 42, tahun_buku: 2030 }).expect(200)).text,
          "<!DOCTYPE html>\n<p>42 / 2030</p>");
        await bookPreview({ nomor_buku: -1 }).expect(422);
        const config = await vendor.get("/api/public/config").expect(200);
        assert.ok(
          !JSON.stringify(config.body).includes("AUDIT_PRIVATE_SETTING"),
        );
      } finally {
        await db.setting.delete({ where: { key: "security_probe" } });
      }
      await admin
        .post("/api/admin/custom/rows")
        .set("X-CSRF-Token", ac)
        .set("Origin", "https://evil.example")
        .send({})
        .expect(403);

      for (const url of [
        "/api/admin/settings",
        "/api/admin/admins",
        "/api/admin/backups",
      ])
        await ordinary.get(url).expect(403);
    },
  );
  await t.test(
    "password tidak dipotong bcrypt: batas 72 byte UTF-8 pada buat/ubah/login",
    async () => {
      const prefix = "Ab1!".repeat(18),
        account = {
          name: "Uji batas password",
          email: "batas-password@bcupt.id",
          role: "admin",
          active: true,
        };
      await post(admin, "/api/admin/admins", {
        ...account,
        password: prefix + "satu",
      }).expect(422);
      await post(admin, "/api/admin/admins", {
        ...account,
        password: "Ab1!" + "é".repeat(35),
      }).expect(422);
      const created = (
        await post(admin, "/api/admin/admins", {
          ...account,
          password: prefix,
        }).expect(200)
      ).body;
      const before = await db.admin.findUnique({ where: { id: created.id } });
      assert.equal(await bcrypt.compare(prefix, before.password), true);
      await admin
        .put("/api/admin/admins/" + created.id)
        .set("X-CSRF-Token", ac)
        .send({ ...account, password: prefix + "dua" })
        .expect(422);
      assert.equal(
        (await db.admin.findUnique({ where: { id: created.id } })).password,
        before.password,
      );
      await post(
        vendor,
        "/api/auth/login",
        { email: account.email, password: prefix + "beda" },
        vc,
      ).expect(422);
    },
  );
  await t.test(
    "pagination pecahan tidak membuat error; tanggal mustahil di tabel kustom ditolak",
    async () => {
      for (const route of [
        "/api/admin/custom?page=1.5&size=2.7",
        "/api/admin/custom/backups?page=1.5&size=2.7",
        "/api/admin/submissions?page=1.5&size=2.7",
      ])
        await admin.get(route).expect(200);
      const row = (await post(admin, "/api/admin/custom/rows", {}).expect(200))
        .body;
      const column = (
        await post(admin, "/api/admin/custom/columns", {
          label: "Tanggal uji keamanan",
          type: "date",
        }).expect(200)
      ).body;
      try {
        const write = (value) =>
          admin
            .put("/api/admin/custom/cell")
            .set("X-CSRF-Token", ac)
            .send({ rowId: row.id, columnId: column.id, value });
        for (const date of ["2026-02-30", "2026-13-01", "2026-02-29", "true"])
          await write(date).expect(400);
        assert.equal(
          await db.customCell.count({
            where: { rowId: row.id, columnId: column.id },
          }),
          0,
        );
        await write("2024-02-29").expect(200);
        await write("").expect(200);
      } finally {
        await admin
          .delete("/api/admin/custom/rows/" + row.id)
          .set("X-CSRF-Token", ac)
          .expect(200);
        await admin
          .delete("/api/admin/custom/columns/" + column.id)
          .set("X-CSRF-Token", ac)
          .expect(200);
      }
    },
  );
  await t.test("akses dokumen token, escaping, HTML dan PDF", async () => {
    await vendor
      .get(`/api/public/submissions/${sub.id}/document/html`)
      .expect(403);
    const h = await vendor
      .get(`/api/public/submissions/${sub.id}/document/html`)
      .set("X-Document-Token", sub.token)
      .expect(200);
    assert.ok(!h.text.includes("<script>"));
    assert.match(h.text, /&lt;script&gt;/);
    // Exercise the actual HTTP endpoint with the same Fetch API used by the UI.
    const pdfResponse = await fetch(
      "http://127.0.0.1:" +
        server.address().port +
        "/api/public/submissions/" +
        sub.id +
        "/document/pdf",
      {
        headers: { "X-Document-Token": sub.token },
        signal: AbortSignal.timeout(60000),
      },
    );
    assert.equal(pdfResponse.status, 200);
    assert.match(pdfResponse.headers.get("content-type"), /application\/pdf/);
    const pdfBytes = Buffer.from(await pdfResponse.arrayBuffer());
    assert.equal(pdfBytes.subarray(0, 4).toString(), "%PDF");
  });
  await t.test("master read-only dan isolasi mode", async () => {
    const search = (
      await admin.get("/api/admin/submissions?q=pt%20vendor").expect(200)
    ).body;
    assert.ok(
      search.total >= 2,
      "Pencarian vendor harus tetap tidak peka huruf besar/kecil pada PostgreSQL",
    );
    await admin
      .patch("/api/admin/submissions/" + sub.id)
      .set("X-CSRF-Token", ac)
      .send({ vendor: "ubah" })
      .expect(404);
    await post(admin, "/api/admin/mode", { mode: "internal" });
    await admin.get("/api/admin/submissions/" + sub.id).expect(404);
    assert.equal((await admin.get("/api/admin/submissions")).body.total, 0);
    await post(admin, "/api/admin/mode", { mode: "eksternal" });
  });
  await t.test(
    "salinan kustom tidak menimpa edit/master; warna diekspor XLSX",
    async () => {
      await post(admin, "/api/admin/custom/sync", {
        confirm: "SINKRONISASI ULANG",
      }).expect(200);
      const d = (await admin.get("/api/admin/custom?all=1")).body,
        c = d.columns.find((c) => c.code === "received_from"),
        row = d.rows.find((r) => r.masterId === sub.id);
      await admin
        .put("/api/admin/custom/cell")
        .set("X-CSRF-Token", ac)
        .send({
          rowId: row.id,
          columnId: c.id,
          value: "Sudah diedit",
          color: "#fff0bb",
        })
        .expect(200);
      await post(admin, "/api/admin/custom/sync", {
        confirm: "SINKRONISASI ULANG",
      }).expect(200);
      assert.equal(
        (
          await db.customCell.findUnique({
            where: { rowId_columnId: { rowId: row.id, columnId: c.id } },
          })
        ).value,
        "Sudah diedit",
      );
      assert.equal(
        (await db.submission.findUnique({ where: { id: sub.id } })).vendor,
        valid.received_from,
      );
      await admin
        .get("/api/admin/custom/export/xlsx")
        .expect(200)
        .then((r) => assert.match(r.headers["content-type"], /spreadsheetml/));
    },
  );
  await t.test(
    "form masuk otomatis menambah baris dan mempertahankan seluruh kustomisasi",
    async () => {
      await post(admin, "/api/admin/custom/sync", {}).expect(400);
      const current = (await admin.get("/api/admin/custom?all=1")).body;
      assert.equal(
        current.rows.filter((r) => r.masterId).length,
        await db.submission.count({ where: { mode: "eksternal" } }),
      );
      const row = current.rows.find((r) => r.masterId === sub.id),
        col = current.columns.find((c) => c.code === "received_from"),
        removed = current.columns.find((c) => c.code === "project_number");
      await admin
        .patch("/api/admin/custom/columns/" + col.id)
        .set("X-CSRF-Token", ac)
        .send({
          label: "Vendor disesuaikan",
          position: 100,
          hidden: true,
          color: "#dceafb",
        })
        .expect(200);
      await admin
        .patch("/api/admin/custom/rows/" + row.id)
        .set("X-CSRF-Token", ac)
        .send({ color: "#dff1e5" })
        .expect(200);
      await admin
        .delete("/api/admin/custom/columns/" + removed.id)
        .set("X-CSRF-Token", ac)
        .expect(200);
      const extra = (
        await post(admin, "/api/admin/custom/columns", {
          label: "Catatan admin",
          type: "short",
          options: [],
        }).expect(200)
      ).body;
      await post(admin, "/api/admin/custom/rows", {}).expect(200);
      await post(admin, "/api/admin/custom/views", {
        name: "View tetap",
        config: { columns: [col.id], q: "Sudah", dir: "desc", sort: col.id },
      }).expect(200);
      const snapshot = async () => ({
        rows: await db.customRow.findMany({
          where: { mode: "eksternal" },
          orderBy: { id: "asc" },
        }),
        cells: await db.customCell.findMany({
          where: { mode: "eksternal" },
          orderBy: { id: "asc" },
        }),
        columns: await db.customColumn.findMany({
          where: { mode: "eksternal" },
          orderBy: { id: "asc" },
        }),
        views: await db.customView.findMany({
          where: { mode: "eksternal" },
          orderBy: { id: "asc" },
        }),
      });
      const before = await snapshot(),
        internalBefore = await db.customRow.count({
          where: { mode: "internal" },
        });
      const incoming = (
        await post(
          vendor,
          "/api/public/eksternal/submit",
          {
            ...body,
            values: {
              ...valid,
              invoice_number: "INV-AUTO",
              project_number: "TIDAK MEMBUAT ULANG KOLOM",
            },
          },
          vc,
        ).expect(201)
      ).body;
      const after = await snapshot(),
        added = after.rows.find((r) => r.masterId === incoming.id);
      assert.ok(added);
      assert.equal(after.rows.length, before.rows.length + 1);
      assert.deepEqual(
        after.rows.filter((r) => r.id !== added.id),
        before.rows,
      );
      assert.deepEqual(
        after.cells.filter((c) => c.rowId !== added.id),
        before.cells,
      );
      assert.deepEqual(after.columns, before.columns);
      assert.deepEqual(after.views, before.views);
      assert.equal(
        after.cells.find((c) => c.rowId === added.id && c.columnId === col.id)
          .value,
        valid.received_from,
      );
      assert.equal(
        after.cells.some(
          (c) => c.rowId === added.id && c.columnId === extra.id,
        ),
        false,
      );
      assert.equal(
        await db.customRow.count({ where: { mode: "internal" } }),
        internalBefore,
      );
      assert.equal(
        (
          await post(admin, "/api/admin/custom/sync", {
            confirm: "SINKRONISASI ULANG",
          }).expect(200)
        ).body.added,
        0,
      );
      assert.ok(
        await db.activityLog.findFirst({
          where: { action: "custom.auto_sync", mode: "eksternal" },
        }),
      );
    },
  );
  const history = async () =>
    (await admin.get("/api/admin/custom/history").expect(200)).body;
  const travel = async (direction, expected = 200) =>
    post(admin, "/api/admin/custom/" + direction, {
      expectedId: (await history())[direction + "Id"],
    }).expect(expected);
  const edit = (url, data) =>
    admin.patch(url).set("X-CSRF-Token", ac).send(data);
  const remove = (url) => admin.delete(url).set("X-CSRF-Token", ac);
  let undoRow, undoCol, undoCell;
  await t.test(
    "Undo/Redo sel, warna, persistensi, autentikasi dan CSRF",
    async () => {
      await vendor.get("/api/admin/custom/history").expect(401);
      await admin
        .post("/api/admin/custom/undo")
        .send({ expectedId: "salah" })
        .expect(403);
      undoRow = (await post(admin, "/api/admin/custom/rows", {}).expect(200))
        .body;
      undoCol = (
        await post(admin, "/api/admin/custom/columns", {
          label: "Kolom Undo",
          type: "short",
        }).expect(200)
      ).body;
      const setCell = (data) =>
        admin
          .put("/api/admin/custom/cell")
          .set("X-CSRF-Token", ac)
          .send({ rowId: undoRow.id, columnId: undoCol.id, ...data });
      undoCell = (
        await setCell({ value: "Awal", color: "#dceafb" }).expect(200)
      ).body;
      await setCell({ value: "Sesudah" }).expect(200);
      const saved = await history();
      assert.equal(saved.undoLabel, "Edit sel");
      assert.deepEqual(
        (await admin.get("/api/admin/custom?all=1")).body.history,
        saved,
      );
      await travel("undo");
      assert.equal(
        (await db.customCell.findUnique({ where: { id: undoCell.id } })).value,
        "Awal",
      );
      await travel("redo");
      assert.equal(
        (await db.customCell.findUnique({ where: { id: undoCell.id } })).value,
        "Sesudah",
      );
      await setCell({ color: "#fff0bb" }).expect(200);
      await travel("undo");
      assert.equal(
        (await db.customCell.findUnique({ where: { id: undoCell.id } })).color,
        "#dceafb",
      );
      assert.equal(
        (await db.customCell.findUnique({ where: { id: undoCell.id } })).value,
        "Sesudah",
      );
      await travel("redo");
      const before = await history();
      await setCell({ value: "Sesudah" }).expect(200);
      assert.deepEqual(
        await history(),
        before,
        "edit dengan nilai sama tidak menambah langkah",
      );
    },
  );
  await t.test(
    "Undo/Redo pulihkan baris/kolom terhapus beserta isi dan warna",
    async () => {
      await edit("/api/admin/custom/rows/" + undoRow.id, {
        color: "#dff1e5",
      }).expect(200);
      await edit("/api/admin/custom/columns/" + undoCol.id, {
        label: "Nama baru",
        color: "#fce0de",
        hidden: true,
        position: 999,
      }).expect(200);
      const expectedRow = await db.customRow.findUnique({
          where: { id: undoRow.id },
        }),
        expectedCol = await db.customColumn.findUnique({
          where: { id: undoCol.id },
        }),
        expectedCell = await db.customCell.findUnique({
          where: { id: undoCell.id },
        });
      await remove("/api/admin/custom/rows/" + undoRow.id).expect(200);
      assert.equal(
        await db.customCell.findUnique({ where: { id: undoCell.id } }),
        null,
      );
      await travel("undo");
      assert.deepEqual(
        await db.customRow.findUnique({ where: { id: undoRow.id } }),
        expectedRow,
      );
      assert.deepEqual(
        await db.customCell.findUnique({ where: { id: undoCell.id } }),
        expectedCell,
      );
      await travel("redo");
      await travel("undo");
      await remove("/api/admin/custom/columns/" + undoCol.id).expect(200);
      await travel("undo");
      assert.deepEqual(
        await db.customColumn.findUnique({ where: { id: undoCol.id } }),
        expectedCol,
      );
      assert.deepEqual(
        await db.customCell.findUnique({ where: { id: undoCell.id } }),
        expectedCell,
      );
      await travel("redo");
      await travel("undo");
    },
  );
  await t.test(
    "urutan/visibilitas kolom satu langkah; view bisa di-undo/redo",
    async () => {
      const before = await db.customColumn.findMany({
          where: { mode: "eksternal" },
          orderBy: { id: "asc" },
        }),
        count = (await history()).undoCount;
      const order = [...before].reverse().map((c) => c.id);
      await post(admin, "/api/admin/custom/columns/order", {
        ids: order,
      }).expect(200);
      assert.equal((await history()).undoCount, count + 1);
      await travel("undo");
      assert.deepEqual(
        await db.customColumn.findMany({
          where: { mode: "eksternal" },
          orderBy: { id: "asc" },
        }),
        before,
      );
      await post(admin, "/api/admin/custom/columns/visibility", {
        visible: [undoCol.id],
      }).expect(200);
      await travel("undo");
      assert.deepEqual(
        await db.customColumn.findMany({
          where: { mode: "eksternal" },
          orderBy: { id: "asc" },
        }),
        before,
      );
      await post(admin, "/api/admin/custom/columns/order", {
        ids: [undoCol.id],
      }).expect(409);
      const view = (
        await post(admin, "/api/admin/custom/views", {
          name: "Undo view",
          config: { columns: [undoCol.id] },
        }).expect(200)
      ).body;
      await travel("undo");
      assert.equal(
        await db.customView.findUnique({ where: { id: view.id } }),
        null,
      );
      await travel("redo");
      assert.ok(await db.customView.findUnique({ where: { id: view.id } }));
      await remove("/api/admin/custom/views/" + view.id).expect(200);
      await travel("undo");
      assert.ok(await db.customView.findUnique({ where: { id: view.id } }));
    },
  );
  await t.test(
    "form masuk otomatis tetap ada dan tidak menghapus Redo; edit baru menghapus Redo",
    async () => {
      await edit("/api/admin/custom/rows/" + undoRow.id, {
        color: "#dceafb",
      }).expect(200);
      await travel("undo");
      const before = await history();
      const incoming = (
        await post(
          vendor,
          "/api/public/eksternal/submit",
          { ...body, values: { ...valid, invoice_number: "INV-UNDO-AUTO" } },
          vc,
        ).expect(201)
      ).body;
      const automatic = await db.customRow.findFirst({
        where: { masterId: incoming.id },
      });
      assert.ok(automatic);
      assert.deepEqual(await history(), before);
      await travel("redo");
      assert.deepEqual(
        await db.customRow.findUnique({ where: { id: automatic.id } }),
        automatic,
      );
      assert.ok(await db.submission.findUnique({ where: { id: incoming.id } }));
      await travel("undo");
      await edit("/api/admin/custom/rows/" + undoRow.id, {
        color: "#fce0de",
      }).expect(200);
      assert.equal((await history()).redoCount, 0);
    },
  );
  await t.test(
    "riwayat terpisah per mode/admin; konflik ditolak tanpa menimpa perubahan orang lain",
    async () => {
      const external = await history();
      await post(admin, "/api/admin/mode", { mode: "internal" }).expect(200);
      assert.equal((await history()).undoCount, 0);
      const row = (await post(admin, "/api/admin/custom/rows", {}).expect(200))
        .body;
      await travel("undo");
      assert.equal(
        await db.customRow.findUnique({ where: { id: row.id } }),
        null,
      );
      await post(admin, "/api/admin/mode", { mode: "eksternal" }).expect(200);
      assert.deepEqual(await history(), external);
      const other = request.agent(server),
        csrf = (await other.get("/api/csrf")).body.token;
      await post(
        other,
        "/api/auth/login",
        { email: "biasa@bcupt.id", password: "PasswordUji!2026" },
        csrf,
      ).expect(200);
      await post(other, "/api/admin/mode", { mode: "eksternal" }, csrf).expect(
        200,
      );
      assert.equal(
        (await other.get("/api/admin/custom/history")).body.undoCount,
        0,
      );
      await other
        .patch("/api/admin/custom/rows/" + undoRow.id)
        .set("X-CSRF-Token", csrf)
        .send({ color: "#fff0bb" })
        .expect(200);
      const before = await history();
      await travel("undo", 409);
      assert.deepEqual(await history(), before);
      assert.equal(
        (await db.customRow.findUnique({ where: { id: undoRow.id } })).color,
        "#fff0bb",
      );
      // An unrelated field changed by another admin survives a successful patch undo.
      await edit("/api/admin/custom/columns/" + undoCol.id, {
        label: "Edit judul saya",
      }).expect(200);
      await other
        .patch("/api/admin/custom/columns/" + undoCol.id)
        .set("X-CSRF-Token", csrf)
        .send({ color: "#dff1e5" })
        .expect(200);
      await travel("undo");
      const column = await db.customColumn.findUnique({
        where: { id: undoCol.id },
      });
      assert.equal(column.label, "Nama baru");
      assert.equal(column.color, "#dff1e5");
      await edit("/api/admin/custom/columns/" + undoCol.id, {
        label: "Perubahan tab lain",
      }).expect(200);
      await post(admin, "/api/admin/custom/undo", {
        expectedId: before.undoId,
      }).expect(409);
    },
  );
  await t.test(
    "riwayat dibatasi 50 langkah dan operasi gagal tidak mengubah data/riwayat",
    async () => {
      for (let i = 0; i < 52; i++)
        await edit("/api/admin/custom/rows/" + undoRow.id, {
          color: i % 2 ? "#fff0bb" : "#dceafb",
        }).expect(200);
      assert.equal((await history()).undoCount, 50);
      const before = await history();
      await edit("/api/admin/custom/columns/tidak-ada", {
        label: "Gagal",
      }).expect(404);
      assert.deepEqual(await history(), before);
      assert.ok(
        await db.activityLog.findFirst({
          where: { action: "custom.undo", mode: "eksternal" },
        }),
      );
      assert.ok(
        await db.activityLog.findFirst({
          where: { action: "custom.redo", mode: "eksternal" },
        }),
      );
    },
  );
  await t.test(
    "Reset salinan menghapus semua riwayat pada mode itu saja",
    async () => {
      const external = await history();
      await post(admin, "/api/admin/mode", { mode: "internal" }).expect(200);
      const ordinary = await db.admin.findUnique({
        where: { email: "biasa@bcupt.id" },
      });
      await db.customHistory.create({
        data: {
          id: `internal:${ordinary.id}`,
          mode: "internal",
          adminId: ordinary.id,
          undo: [],
          redo: [],
        },
      });
      const internal = await history();
      await post(admin, "/api/admin/custom/reset", { confirm: "salah" }).expect(
        400,
      );
      assert.deepEqual(await history(), internal);
      await post(admin, "/api/admin/custom/reset", {
        confirm: "RESET SALINAN",
      }).expect(200);
      assert.equal(
        await db.customHistory.count({ where: { mode: "internal" } }),
        0,
      );
      assert.equal((await history()).undoCount, 0);
      assert.equal((await history()).redoCount, 0);
      await post(admin, "/api/admin/mode", { mode: "eksternal" }).expect(200);
      assert.deepEqual(await history(), external);
    },
  );
  await t.test(
    "batas tanggal disimpan builder dan ditolak server jika dilewati",
    async () => {
      const current = (await admin.get("/api/admin/form")).body;
      const update = (fields) =>
        admin.put("/api/admin/form").set("X-CSRF-Token", ac).send({
          fields,
          sections: current.version.sections,
          baseVersionId: current.version.id,
          note: "Uji batas tanggal",
        });
      const fields = structuredClone(current.version.fields),
        date = fields.find((f) => f.code === "invoice_date");
      date.validation = { monthsBack: -1 };
      await update(fields).expect(400);
      date.validation = { monthsBack: 6, noFuture: true };
      const saved = (await update(fields).expect(200)).body.version;
      await post(
        vendor,
        "/api/public/eksternal/submit",
        {
          ...body,
          formVersionId: saved.id,
          values: { ...valid, invoice_date: "2020-01-01" },
        },
        vc,
      ).expect(422);
      const restored = (
        await admin
          .put("/api/admin/form")
          .set("X-CSRF-Token", ac)
          .send({
            fields: current.version.fields,
            sections: current.version.sections,
            baseVersionId: saved.id,
            note: "Pulihkan setelah tes",
          })
          .expect(200)
      ).body.version;
      body.formVersionId = restored.id;
    },
  );
  await t.test(
    "CRUD field, versi historis, loop dan hard delete ditolak",
    async () => {
      const f = (await admin.get("/api/admin/form")).body.version;
      const fields = [
        ...f.fields,
        {
          code: "catatan_baru",
          label: "Catatan baru",
          type: "long",
          required: false,
          active: true,
          options: [],
          validation: {},
          section: "utama",
        },
      ];
      const put = (body) =>
        admin.put("/api/admin/form").set("X-CSRF-Token", ac).send(body);
      const r = await put({
        fields,
        sections: f.sections,
        baseVersionId: f.id,
      }).expect(200);
      const id = r.body.version.id;
      assert.notEqual(id, f.id);
      assert.equal(
        (await db.submission.findUnique({ where: { id: sub.id } }))
          .formVersionId,
        form.id,
      );
      await put({
        fields: fields.filter((f) => f.code !== "received_from"),
        sections: f.sections,
        baseVersionId: id,
      }).expect(400);
      const bad = structuredClone(fields);
      bad[0].options[0].action = { type: "jump", target: "paham_ketentuan" };
      await put({
        fields: bad,
        sections: f.sections,
        baseVersionId: id,
      }).expect(400);
      await put({
        fields: fields.map((f) =>
          f.code === "received_from" ? { ...f, active: false } : f,
        ),
        sections: f.sections,
        baseVersionId: id,
      }).expect(200);
      await post(vendor, "/api/public/eksternal/submit", body, vc).expect(409);
    },
  );
  await t.test("sanitasi ketentuan, draft, publish, rollback", async () => {
    await admin
      .put("/api/admin/terms/draft")
      .set("X-CSRF-Token", ac)
      .send({
        html: '<h2>Baru</h2><script>alert(1)</script><img src="x" onerror="alert(1)">',
      })
      .expect(200);
    let d = (await admin.get("/api/admin/terms")).body;
    assert.ok(!d.term.draft.includes("<script>"));
    assert.notEqual(d.term.publishedId, null);
    await post(admin, "/api/admin/terms/version", {
      html: d.term.draft,
      publish: true,
    }).expect(200);
    d = (await admin.get("/api/admin/terms")).body;
    assert.equal(
      (await vendor.get("/api/public/eksternal/form")).body.terms.html,
      "<h2>Baru</h2>",
    );
    await post(
      admin,
      "/api/admin/terms/rollback/" + d.versions.at(-1).id,
      {},
    ).expect(200);
  });
  await t.test(
    "template aman, versi baru, placeholder lama tetap historis",
    async () => {
      const d = (await admin.get("/api/admin/template")).body;
      await admin
        .put("/api/admin/template")
        .set("X-CSRF-Token", ac)
        .send({
          html: '<style>@import "https://x";</style>',
          baseVersionId: d.current.id,
        })
        .expect(400);
      await admin
        .put("/api/admin/template")
        .set("X-CSRF-Token", ac)
        .send({
          html: d.current.html.replace("RECEIPT OF INVOICE", "BUKTI ROI"),
          baseVersionId: d.current.id,
        })
        .expect(200);
      assert.equal(
        (await db.submission.findUnique({ where: { id: sub.id } }))
          .templateVersionId,
        d.current.id,
      );
    },
  );
  await t.test(
    "SMTP password terenkripsi dan email transport mock berlampiran PDF",
    async () => {
      await admin
        .put("/api/admin/settings")
        .set("X-CSRF-Token", ac)
        .send({ smtp_password: "RahasiaSMTP!" })
        .expect(200);
      assert.notEqual(
        (await db.setting.findUnique({ where: { key: "smtp_password" } }))
          .value,
        "RahasiaSMTP!",
      );
      const publicSettings = (await admin.get("/api/admin/settings")).body;
      assert.equal(publicSettings.smtp_password, undefined);
      const row = await db.submission.findUnique({ where: { id: sub.id } });
      await sendMail({
        recipient: "test@example.com",
        sub: row,
        req: { mode: "eksternal" },
        transport: nodemailer.createTransport({
          streamTransport: true,
          buffer: true,
        }),
      });
      assert.equal(
        await db.emailLog.count({
          where: { submissionId: sub.id, status: "terkirim", recipient: "test@example.com" },
        }),
        1,
      );
      await assert.rejects(() =>
        sendMail({
          recipient: "test@example.com",
          sub: row,
          req: { mode: "eksternal" },
          transport: {
            sendMail: async () => {
              throw Error("SMTP mock gagal");
            },
          },
        }),
      );
      assert.equal(await db.emailLog.count({ where: { status: "gagal" } }), 1);
    },
  );
  await t.test("upload validasi signature dan isolasi akses", async () => {
    await vendor
      .post("/api/public/eksternal/upload")
      .set("X-CSRF-Token", vc)
      .attach("file", Buffer.from("<script>bad</script>"), {
        filename: "fake.png",
        contentType: "image/png",
      })
      .expect(400);
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jGxkAAAAASUVORK5CYII=",
      "base64",
    );
    const u = (
      await admin
        .post("/api/admin/uploads")
        .set("X-CSRF-Token", ac)
        .attach("file", png, {
          filename: "pixel.png",
          contentType: "image/png",
        })
        .expect(200)
    ).body;
    await vendor.get(u.location).expect(200);
  });
  await t.test(
    "show/off ketentuan terpisah per mode, persetujuan server dan draft kedaluwarsa",
    async () => {
      const internalBefore = (await vendor.get("/api/public/internal/form"))
        .body;
      const before = (await admin.get("/api/admin/terms")).body;
      const put = (b) =>
        admin
          .put("/api/admin/terms/visibility")
          .set("X-CSRF-Token", ac)
          .send(b);
      await put({
        enabled: false,
        baseRevision: before.visibility.revision,
      }).expect(200);
      const hidden = (await vendor.get("/api/public/eksternal/form")).body;
      assert.equal(hidden.termsEnabled, false);
      assert.equal(hidden.terms, null);
      assert.equal(
        hidden.form.fields.find((f) => f.code === "paham_ketentuan").active,
        false,
      );
      assert.equal(
        (await vendor.get("/api/public/internal/form")).body.termsEnabled,
        internalBefore.termsEnabled,
      );
      const payload = {
        formVersionId: hidden.form.id,
        termsVersionId: hidden.termsVersionId,
        termsRevision: hidden.termsRevision,
        accepted: false,
        startedAt: new Date().toISOString(),
        values: { ...valid, paham_ketentuan: "Belum" },
      };
      const created = (
        await post(vendor, "/api/public/eksternal/submit", payload, vc).expect(
          201,
        )
      ).body;
      const saved = await db.submission.findUnique({
        where: { id: created.id },
      });
      assert.equal(saved.documentSettings.termsAccepted, false);
      assert.equal(saved.documentSettings.termsEnabled, false);
      assert.equal(saved.values.paham_ketentuan, undefined);
      await put({
        enabled: true,
        baseRevision: before.visibility.revision,
      }).expect(409);
      await put({ enabled: true, baseRevision: hidden.termsRevision }).expect(
        200,
      );
      await post(vendor, "/api/public/eksternal/submit", payload, vc).expect(
        409,
      );
      const shown = (await vendor.get("/api/public/eksternal/form")).body;
      assert.ok(shown.terms.html);
      await post(
        vendor,
        "/api/public/eksternal/submit",
        { ...payload, termsRevision: shown.termsRevision },
        vc,
      ).expect(422);
      assert.ok(
        (await db.activityLog.count({
          where: { mode: "eksternal", action: "terms.visibility" },
        })) >= 2,
      );
    },
  );
  await t.test(
    "pilihan backup tabel: snapshot tetap, isolasi mode dan XLSX/CSV/JSON aman",
    async () => {
      const fixtures = [];
      try {
        for (const mode of ["internal", "eksternal"]) {
          const column = await db.customColumn.create({
            data: {
              mode,
              code: "snapshot_test",
              label: "Label snapshot " + mode,
              type: "short",
              options: [],
              position: 9999,
              hidden: true,
              color: "#dceafb",
            },
          });
          const row = await db.customRow.create({
            data: { mode, color: "#dff1e5" },
          });
          const cell = await db.customCell.create({
            data: {
              mode,
              rowId: row.id,
              columnId: column.id,
              value:
                mode === "internal" ? "DATA_INTERNAL_RAHASIA" : "NILAI_LAMA",
              color: "#fff0bb",
            },
          });
          const view = await db.customView.create({
            data: {
              mode,
              name: "View snapshot",
              config: { columns: [column.id] },
            },
          });
          fixtures.push({ mode, column, row, cell, view });
        }
        const backup = await createBackup({
          scheduledSlot: "2026-11-12 12:00",
        });
        const external = fixtures.find((f) => f.mode === "eksternal");
        await db.customCell.update({
          where: { id: external.cell.id },
          data: { value: "NILAI_BARU", color: "#fce0de" },
        });
        await db.customColumn.update({
          where: { id: external.column.id },
          data: { label: "Label sekarang" },
        });
        const other = request.agent(server),
          csrf = (await other.get("/api/csrf")).body.token;
        await post(
          other,
          "/api/auth/login",
          { email: "biasa@bcupt.id", password: "PasswordUji!2026" },
          csrf,
        ).expect(200);
        await post(
          other,
          "/api/admin/mode",
          { mode: "eksternal" },
          csrf,
        ).expect(200);
        await vendor.get("/api/admin/custom/backups").expect(401);
        await other
          .get("/api/admin/backups/" + backup.id + "/download")
          .expect(403);
        const listed = (
          await other.get("/api/admin/custom/backups?size=1&page=1").expect(200)
        ).body;
        assert.equal(listed.rows.length, 1);
        assert.equal(listed.rows[0].filename, undefined);
        assert.deepEqual(listed.schedule, ["00:00", "12:00"]);
        const snapshot = (
          await other
            .get("/api/admin/custom/backups/" + backup.id + "?mode=internal")
            .expect(200)
        ).body;
        assert.equal(snapshot.mode, "eksternal");
        assert.equal(snapshot.scheduledSlot, "2026-11-12 12:00");
        assert.equal(
          snapshot.cells.find((c) => c.id === external.cell.id).value,
          "NILAI_LAMA",
        );
        assert.equal(
          snapshot.columns.find((c) => c.id === external.column.id).label,
          "Label snapshot eksternal",
        );
        assert.equal(
          snapshot.views.find((v) => v.id === external.view.id).name,
          "View snapshot",
        );
        assert.ok(!JSON.stringify(snapshot).includes("DATA_INTERNAL_RAHASIA"));
        assert.equal(snapshot.tables, undefined);
        const json = (
          await other
            .get("/api/admin/custom/backups/" + backup.id + "/export/json")
            .expect(200)
        ).body;
        assert.deepEqual(json, snapshot);
        const csv = await other
          .get("/api/admin/custom/backups/" + backup.id + "/export/csv")
          .expect(200);
        assert.match(csv.text, /NILAI_LAMA/);
        assert.ok(!csv.text.includes("DATA_INTERNAL_RAHASIA"));
        const xlsx = await other
          .get("/api/admin/custom/backups/" + backup.id + "/export/xlsx")
          .buffer(true)
          .parse((response, cb) => {
            const chunks = [];
            response.on("data", (x) => chunks.push(x));
            response.on("end", () => cb(null, Buffer.concat(chunks)));
          })
          .expect(200);
        const book = new ExcelJS.Workbook();
        await book.xlsx.load(xlsx.body);
        const sheet = book.worksheets[0];
        let matched = false;
        sheet.eachRow((row) =>
          row.eachCell((cell) => {
            if (cell.value === "NILAI_LAMA") {
              matched = true;
              assert.equal(cell.fill.fgColor.argb, "FFFFF0BB");
              assert.equal(sheet.getColumn(cell.col).hidden, true);
            }
          }),
        );
        assert.ok(matched);
        await post(other, "/api/admin/mode", { mode: "internal" }, csrf).expect(
          200,
        );
        const internal = (
          await other.get("/api/admin/custom/backups/" + backup.id).expect(200)
        ).body;
        assert.ok(JSON.stringify(internal).includes("DATA_INTERNAL_RAHASIA"));
        assert.ok(!JSON.stringify(internal).includes("NILAI_LAMA"));
        await other.get("/api/admin/custom/backups/not-found").expect(404);
        await other
          .get("/api/admin/custom/backups/" + backup.id + "/export/zip")
          .expect(400);
        assert.equal(
          (await db.customCell.findUnique({ where: { id: external.cell.id } }))
            .value,
          "NILAI_BARU",
        );
      } finally {
        for (const f of fixtures) {
          await db.customCell.delete({ where: { id: f.cell.id } });
          await db.customRow.delete({ where: { id: f.row.id } });
          await db.customColumn.delete({ where: { id: f.column.id } });
          await db.customView.delete({ where: { id: f.view.id } });
        }
      }
    },
  );
  await t.test(
    "hapus pertanyaan tersembunyi dari form Internal aktif; riwayat dan Eksternal tetap",
    async () => {
      const original = (await vendor.get("/api/public/internal/form")).body;
      const historicalPayload = {
        formVersionId: original.form.id,
        termsVersionId: original.termsVersionId,
        termsRevision: original.termsRevision,
        accepted: true,
        startedAt: new Date().toISOString(),
        values: { ...valid, email_anda: "annie.la@bcupt.id" },
      };
      const historical = (
        await post(
          vendor,
          "/api/public/internal/submit",
          historicalPayload,
          vc,
        ).expect(201)
      ).body;
      const externalBefore = await db.form.findUnique({
        where: { mode: "eksternal" },
      });
      const externalResult = await removeHiddenConsent(db, "eksternal");
      assert.equal(externalResult.removed, false);
      const saved = await db.setting.findUnique({
        where: { key: "terms_visibility_internal" },
      });
      const revision = (saved?.value.revision || 0) + 1;
      try {
        await db.setting.upsert({
          where: { key: "terms_visibility_internal" },
          create: {
            key: "terms_visibility_internal",
            value: { enabled: false, revision },
          },
          update: { value: { enabled: false, revision } },
        });
        const result = await removeHiddenConsent(db, "internal");
        assert.equal(result.removed, true);
        const current = (await vendor.get("/api/public/internal/form")).body;
        assert.ok(
          !current.form.fields.some((f) => f.code === "paham_ketentuan"),
        );
        assert.ok(
          current.form.sections.every((section) =>
            current.form.fields.some((f) => f.code === section.firstField),
          ),
        );
        assert.equal(
          (await db.submission.findUnique({ where: { id: historical.id } }))
            .formVersionId,
          original.form.id,
        );
        assert.equal(
          (
            await db.submissionValue.findFirst({
              where: { submissionId: historical.id, code: "paham_ketentuan" },
            })
          ).value,
          "Ya",
        );
        assert.ok(
          (
            await db.formVersion.findUnique({ where: { id: original.form.id } })
          ).fields.some((f) => f.code === "paham_ketentuan"),
        );
        assert.equal(
          (
            await db.formField.findUnique({
              where: {
                mode_code: { mode: "internal", code: "paham_ketentuan" },
              },
            })
          ).definition.active,
          false,
        );
        assert.equal(
          (await removeHiddenConsent(db, "internal")).removed,
          false,
        );
        await post(
          vendor,
          "/api/public/internal/submit",
          historicalPayload,
          vc,
        ).expect(409);
        await post(admin, "/api/admin/mode", { mode: "internal" }).expect(200);
        assert.ok(
          !(await admin.get("/api/admin/form")).body.version.fields.some(
            (f) => f.code === "paham_ketentuan",
          ),
        );
        await post(admin, "/api/admin/mode", { mode: "eksternal" }).expect(200);
        assert.deepEqual(
          await db.form.findUnique({ where: { mode: "eksternal" } }),
          externalBefore,
        );
        await db.setting.update({
          where: { key: "terms_visibility_internal" },
          data: { value: { enabled: true, revision: revision + 1 } },
        });
        await post(
          vendor,
          "/api/public/internal/submit",
          {
            ...historicalPayload,
            formVersionId: current.form.id,
            termsRevision: revision + 1,
            accepted: false,
          },
          vc,
        ).expect(422);
      } finally {
        if (saved)
          await db.setting.update({
            where: { key: saved.key },
            data: { value: saved.value },
          });
        else
          await db.setting.deleteMany({
            where: { key: "terms_visibility_internal" },
          });
      }
    },
  );
  await t.test(
    "backup terenkripsi, restore dua langkah, pengaman, session berakhir",
    async () => {
      const before = await db.submission.count(),
        b = (await post(admin, "/api/admin/backups", {}).expect(200)).body;
      await admin
        .put("/api/admin/settings")
        .set("X-CSRF-Token", ac)
        .send({ backup_lokasi: "arsip-baru" })
        .expect(200);
      await admin.get("/api/admin/backups/" + b.id + "/download").expect(200);
      await post(admin, "/api/admin/custom/rows", {});
      await admin
        .put("/api/admin/settings")
        .set("X-CSRF-Token", ac)
        .send({ nama_aplikasi: "Ubah setelah backup" })
        .expect(200);
      await post(admin, "/api/admin/backups/" + b.id + "/restore", {
        confirm: "asal",
      }).expect(400);
      const ticket = (
        await post(
          admin,
          "/api/admin/backups/" + b.id + "/prepare-restore",
          {},
        ).expect(200)
      ).body;
      await post(admin, "/api/admin/backups/" + b.id + "/restore", {
        token: ticket.token,
        confirm: ticket.phrase,
      }).expect(200);
      assert.notEqual((await settings()).nama_aplikasi, "Ubah setelah backup");
      assert.equal(await db.submission.count(), before);
      assert.ok((await db.backup.count()) >= 2);
      assert.equal(await db.customHistory.count(), 0);
      assert.equal(await db.session.count(), 0);
      assert.ok((await db.upload.count()) >= 1);
    },
  );
});
