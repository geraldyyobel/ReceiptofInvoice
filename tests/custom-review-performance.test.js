import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import request from "supertest";
import { app } from "../server/app.js";
import { db } from "../server/core.js";

if (process.env.NODE_ENV !== "test") throw Error("Gunakan database uji terpisah");

test("review pada 10.000 baris per mode tetap dipaginasi dan progres tidak mengikuti pencarian", async (t) => {
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const admin = request.agent(server), year = 2196, prefix = "review-volume-" + crypto.randomUUID();
  const columnIds = [];
  try {
    const csrf = (await admin.get("/api/csrf")).body.token;
    await admin.post("/api/auth/login").set("X-CSRF-Token", csrf).send({ email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD }).expect(200);
    for (const mode of ["internal", "eksternal"]) {
      const columns = [];
      for (const type of ["short", "number"]) {
        const column = await db.customColumn.create({ data: { mode, code: prefix + type, label: prefix + type, type, options: [], position: 9999 } });
        columns.push(column); columnIds.push(column.id);
      }
      for (let offset = 0; offset < 10000; offset += 500) {
        const rows = Array.from({ length: 500 }, (_, j) => {
          const i = offset + j;
          return { id: `${prefix}-${mode}-${i}`, mode, bookYear: year, bookNumber: i + 1,
            reviewChecked: i % 2 === 0, reviewFlag: i % 5 === 0 ? "problem" : i % 5 === 1 ? "followup" : null,
            reviewNote: i % 10 === 0 ? "Catatan volume " + mode : null };
        });
        await db.customRow.createMany({ data: rows });
        await db.customCell.createMany({ data: rows.flatMap((r, j) => [
          { mode, rowId: r.id, columnId: columns[0].id, value: "REVIEW-VOLUME-" + String(offset + j).padStart(5, "0") },
          { mode, rowId: r.id, columnId: columns[1].id, value: offset + j },
        ]) });
      }
      await admin.post("/api/admin/mode").set("X-CSRF-Token", csrf).send({ mode }).expect(200);
      const measured = async (query) => {
        const start = performance.now();
        const list = (await admin.get("/api/admin/custom").query({ year, size: 50, ...query }).expect(200)).body;
        t.diagnostic(`${process.env.DATABASE_PROVIDER} ${mode} ${query.review || "semua"}: ${Math.round(performance.now() - start)} ms`);
        assert.deepEqual(list.reviewProgress, { total: 10000, checked: 5000, flagged: 4000, noted: 1000 });
        assert.ok(list.rows.length <= 50);
        const ids = new Set(list.rows.map((r) => r.id)); assert.ok(list.cells.every((c) => ids.has(c.rowId) && c.mode === mode));
        assert.ok(Buffer.byteLength(JSON.stringify(list)) < 150000, "respons hanya membawa satu halaman");
        return list;
      };
      assert.equal((await measured({})).total, 10000);
      const one = await measured({ review: "problem", sort: columns[1].id, dir: "desc" });
      const two = await measured({ review: "problem", sort: columns[1].id, dir: "desc", page: 2 });
      assert.equal(one.total, 2000); assert.equal(two.total, 2000);
      assert.equal(one.rows[0].bookNumber, 9996);
      assert.equal(two.rows[0].bookNumber, 9746);
      assert.ok(!one.rows.some((a) => two.rows.some((b) => a.id === b.id)));
      assert.equal((await measured({ review: "flagged", q: "REVIEW-VOLUME-000" })).total, 40);
      assert.equal((await measured({ review: "noted", q: "REVIEW-VOLUME-09990" })).total, 1);
      assert.equal((await measured({ review: "unchecked", q: "TIDAK-ADA" })).total, 0);
    }
  } finally {
    await db.customCell.deleteMany({ where: { columnId: { in: columnIds } } });
    await db.customRow.deleteMany({ where: { id: { startsWith: prefix } } });
    await db.customColumn.deleteMany({ where: { id: { in: columnIds } } });
    await new Promise((resolve) => server.close(resolve));
    await db.$disconnect();
  }
});
