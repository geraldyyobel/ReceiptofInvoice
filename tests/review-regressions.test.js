import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { app } from "../server/app.js";
import { db } from "../server/core.js";
import { indexCells } from "../shared/table-data.js";

if (process.env.NODE_ENV !== "test") throw Error("Gunakan runner database uji terpisah");

test("regresi audit: simpan bersamaan dan angka tabel kustom", async (t) => {
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const admin = request.agent(server);
  const csrf = (await admin.get("/api/csrf")).body.token;
  const post = (url, body) => admin.post(url).set("X-CSRF-Token", csrf).send(body);
  try {
    await post("/api/auth/login", { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD }).expect(200);
    await post("/api/admin/mode", { mode: "internal" }).expect(200);
    await t.test("dua tab dengan versi form sama: hanya satu penyimpanan berhasil", async () => {
      const current = (await admin.get("/api/admin/form")).body.version;
      const before = await db.formVersion.count({ where: { mode: "internal" } });
      const results = await Promise.all(Array.from({ length: 6 }, (_, i) => {
        const fields = structuredClone(current.fields); fields[0].label = "Pertanyaan audit " + i;
        return admin.put("/api/admin/form").set("X-CSRF-Token", csrf).send({
          baseVersionId: current.id, fields, sections: current.sections, note: "Simpan serentak " + i,
        });
      }));
      assert.equal(results.filter((r) => r.status === 200).length, 1, "Satu versi lama tidak boleh diterima beberapa kali");
      assert.equal(results.filter((r) => r.status === 409).length, 5);
      assert.equal(await db.formVersion.count({ where: { mode: "internal" } }), before + 1);
      const winner = results.find((r) => r.status === 200).body.version;
      assert.equal((await db.form.findUnique({ where: { mode: "internal" } })).currentId, winner.id);
    });
    await t.test("dua tab dengan versi template sama: hanya satu versi baru disimpan", async () => {
      const current = (await admin.get("/api/admin/template")).body.current;
      const before = await db.templateVersion.count({ where: { mode: "internal" } });
      const results = await Promise.all(Array.from({ length: 6 }, (_, i) =>
        admin.put("/api/admin/template").set("X-CSRF-Token", csrf).send({
          baseVersionId: current.id, html: `<html><body><p>Template audit ${i}: {{nomor_referensi}}</p></body></html>`,
        }),
      ));
      assert.equal(results.filter((r) => r.status === 200).length, 1);
      assert.equal(results.filter((r) => r.status === 409).length, 5);
      assert.equal(await db.templateVersion.count({ where: { mode: "internal" } }), before + 1);
    });
    const column = (await post("/api/admin/custom/columns", { label: "Angka audit", type: "number" }).expect(200)).body;
    const rows = [];
    for (const value of ["1e3", "-2", "10", "0.0000005", "1", "1e-99999", "1e-400", "1e+308"]) {
      const row = (await post("/api/admin/custom/rows", { year: 2095 }).expect(200)).body;
      rows.push(row);
      // Simulate values accepted and retained by the previous API version.
      await db.customCell.create({ data: { mode: "internal", rowId: row.id, columnId: column.id, value } });
    }
    await t.test("sorting angka lama bertipe teks/scientific mengikuti nilai numeriknya", async () => {
      const page = (await admin.get("/api/admin/custom").query({ year: 2095, sort: column.id }).expect(200)).body;
      const cells = indexCells(page.cells);
      assert.deepEqual(page.rows.map((r) => Number(cells.get(r.id).get(column.id).value)), [-2, 0, 0, 0.0000005, 1, 10, 1000, 1e308]);
    });
    await t.test("angka dari API dinormalisasi; boolean, teks kosong dan heksadesimal ditolak", async () => {
      const edit = (value) => admin.put("/api/admin/custom/cell").set("X-CSRF-Token", csrf)
        .send({ rowId: rows[0].id, columnId: column.id, value });
      const numeric = (await edit("1e3").expect(200)).body;
      assert.equal(numeric.value, 1000);
      for (const invalid of [true, false, "   ", "0x10", "Infinity"])
        await edit(invalid).expect(400);
      assert.equal((await db.customCell.findUnique({ where: { id: numeric.id } })).value, 1000);
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await db.$disconnect();
  }
});
