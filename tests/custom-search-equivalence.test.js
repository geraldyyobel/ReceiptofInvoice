import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "../server/core.js";
import { customOptions, customPlan, customRows } from "../server/custom-query.js";

if (process.env.NODE_ENV !== "test") throw Error("Gunakan database uji terpisah");

test("pencarian IN DISTINCT menghasilkan ID, urutan dan halaman yang sama dengan EXISTS lama", async (t) => {
  const prefix = "search-equivalence-" + crypto.randomUUID(), ids = [], columns = [];
  const provider = process.env.DATABASE_PROVIDER || "sqlite";
  const name = (v) => Prisma.raw(provider === "mysql" ? `\`${v}\`` : `"${v}"`);
  const field = (alias, v) => Prisma.sql`${name(alias)}.${name(v)}`;
  const value = field("c", "value");
  const text = provider === "postgresql" ? Prisma.sql`(${value} #>> '{}')`
    : provider === "mysql" ? Prisma.sql`JSON_UNQUOTE(${value})` : Prisma.sql`CAST(json_extract(${value}, '$') AS TEXT)`;
  const values = ["ABC vendor", "abc vendor", "%_! literal", "O'Reilly", "中文", "a\\b", "", null, 13, true, false, ["ABC", "x"], { vendor: "ABC" }, "=ABC", 'kutip "ABC"'];
  try {
    for (const mode of ["internal", "eksternal"]) {
      const cs = [];
      for (let i = 0; i < 2; i++) cs.push(await db.customColumn.create({ data: { mode, code: prefix + i, label: prefix + i, type: "short", options: [], position: 9999 } }));
      columns.push(...cs.map((c) => c.id));
      for (let i = 0; i < values.length; i++) {
        const row = await db.customRow.create({ data: { mode, bookYear: 2186 + i % 2, bookNumber: i + 1,
          reviewChecked: i % 2 === 0, reviewFlag: i % 3 === 0 ? "followup" : i % 3 === 1 ? "problem" : null, reviewNote: i % 2 === 0 ? "Catatan" : null } });
        ids.push(row.id);
        for (const column of cs) await db.customCell.create({ data: { mode, rowId: row.id, columnId: column.id, value: values[i] === null ? Prisma.JsonNull : values[i] } });
      }
      for (const q of ["", "ABC", " ABC ", "%_!", "O'Reilly", "中文", "13", "true", "a\\b", "TIDAK ADA"]) {
        for (const year of [2186, 2187]) {
        for (const review of [undefined, "flagged", "problem", "noted", "unchecked"]) {
          const options = customOptions({ q, review, year, sort: cs[0].id, dir: "desc" });
          const plan = await customPlan(db, mode, options), clauses = [plan.yearWhere];
          if (review === "flagged") clauses.push(plan.flagged);
          if (review === "problem") clauses.push(Prisma.sql`${field("r", "reviewFlag")} = ${"problem"}`);
          if (review === "noted") clauses.push(plan.noted);
          if (review === "unchecked") clauses.push(Prisma.sql`${field("r", "reviewChecked")} = ${false}`);
          if (options.q) clauses.push(Prisma.sql`EXISTS (SELECT 1 FROM ${name("custom_cells")} AS ${name("c")}
            WHERE ${field("c", "rowId")} = ${field("r", "id")} AND ${field("c", "mode")} = ${mode}
            AND LOWER(COALESCE(${text}, '')) LIKE ${"%" + options.q.toLowerCase().replace(/[!%_]/g, "!$&") + "%"} ESCAPE '!')`);
          const old = await db.$queryRaw(Prisma.sql`SELECT ${field("r", "id")} FROM ${name("custom_rows")} AS ${name("r")}
            ${plan.join} WHERE ${Prisma.join(clauses, " AND ")} ORDER BY ${plan.order}`);
          const current = await customRows(db, plan, 0, 100);
          assert.deepEqual(current.map((r) => r.id), old.map((r) => r.id), `${mode}/${q}/${review}`);
          assert.equal(new Set(current.map((r) => r.id)).size, current.length, "sel ganda tidak menggandakan baris");
          const second = await customRows(db, plan, 2, 2);
          assert.deepEqual(second.map((r) => r.id), old.slice(2, 4).map((r) => r.id));
        }
        }
      }
    }
    t.diagnostic("200 kombinasi mode/tahun/input/filter, termasuk wildcard literal, JSON, sel ganda dan pagination, dibandingkan langsung dengan SQL EXISTS lama.");
  } finally {
    await db.customCell.deleteMany({ where: { rowId: { in: ids } } });
    await db.customRow.deleteMany({ where: { id: { in: ids } } });
    await db.customColumn.deleteMany({ where: { id: { in: columns } } });
    await db.$disconnect();
  }
});
