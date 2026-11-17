import { Prisma } from "@prisma/client";
import { db, settings, inTimezone, fail } from "./core.js";
import { validDate } from "../shared/date-limits.js";

export function invoiceYear(value, fallback = new Date(), zone = "Asia/Jakarta") {
  return validDate(value) && Number(value.slice(0, 4)) > 0
    ? Number(value.slice(0, 4))
    : Number(inTimezone(new Date(fallback), zone).slice(0, 4));
}
export function bookYearFilter(value, currentYear) {
  if (value === undefined || value === "" || value === "all") return null;
  if (value === "current") return currentYear;
  if (!/^\d{1,4}$/.test(String(value)) || Number(value) < 1 || Number(value) > 9999)
    throw fail("Tahun buku tidak valid", 422);
  return Number(value);
}
export async function nextBookNumber(tx, mode, bookYear) {
  const counter = await tx.counter.upsert({
    where: { key: `book:${mode}:${bookYear}` },
    create: { key: `book:${mode}:${bookYear}`, value: 1 },
    update: { value: { increment: 1 } },
  });
  return { bookYear, bookNumber: counter.value };
}
export async function submissionBook(tx, sub, zone = "Asia/Jakarta") {
  if (sub.bookYear && sub.bookNumber) return { bookYear: sub.bookYear, bookNumber: sub.bookNumber };
  const book = await nextBookNumber(tx, sub.mode, invoiceYear(sub.values?.invoice_date, sub.submittedAt, zone));
  await tx.submission.update({ where: { id: sub.id }, data: book });
  Object.assign(sub, book);
  return book;
}
export async function bookYears(client, model, mode) {
  return (await client[model].groupBy({
    by: ["bookYear"], where: { mode, bookYear: { not: null } },
    _count: true, orderBy: { bookYear: "desc" },
  })).map((r) => ({ year: r.bookYear, count: r._count }));
}

// Upgrade existing data/old backups without changing IDs, references, answers or colors.
// Nullable columns allow old archives to be inserted before this backfill runs.
export async function backfillBooks(tx) {
  const missing = { OR: [{ bookYear: null }, { bookNumber: null }] };
  const [masterCount, rowCount, marker] = await Promise.all([
    tx.submission.count({ where: missing }), tx.customRow.count({ where: missing }),
    tx.setting.findUnique({ where: { key: "bookkeeping_v1" } }),
  ]);
  if (!masterCount && !rowCount && marker) return;
  const zone = (await settings(tx)).zona_waktu || "Asia/Jakarta";
  const counters = new Map((await tx.counter.findMany({ where: { key: { startsWith: "book:" } } }))
    .map((r) => [r.key, r.value]));
  for (const model of ["submission", "customRow"]) {
    for (const r of await tx[model].groupBy({ by: ["mode", "bookYear"],
      where: { bookYear: { not: null } }, _max: { bookNumber: true } })) {
      const key = `book:${r.mode}:${r.bookYear}`;
      counters.set(key, Math.max(counters.get(key) || 0, r._max.bookNumber || 0));
    }
  }
  const allocate = (mode, year) => {
    const key = `book:${mode}:${year}`, number = (counters.get(key) || 0) + 1;
    counters.set(key, number);
    return { bookYear: year, bookNumber: number };
  };
  async function write(model, rows) {
    if (process.env.DATABASE_PROVIDER === "postgresql") {
      const table = Prisma.raw(model === "submission" ? '"submissions"' : '"custom_rows"');
      for (let i = 0; i < rows.length; i += 300) {
        const values = rows.slice(i, i + 300).map((r) => Prisma.sql`(${r.id}, ${r.bookYear}::int, ${r.bookNumber}::int)`);
        await tx.$executeRaw(Prisma.sql`UPDATE ${table} AS t SET "bookYear" = v.y, "bookNumber" = v.n
          FROM (VALUES ${Prisma.join(values)}) AS v(id, y, n) WHERE t.id = v.id`);
      }
    } else {
      for (const { id, bookYear, bookNumber } of rows)
        await tx[model].update({ where: { id }, data: { bookYear, bookNumber } });
    }
  }
  const masters = await tx.submission.findMany({
    orderBy: [{ submittedAt: "asc" }, { id: "asc" }],
    select: { id: true, mode: true, bookYear: true, bookNumber: true, values: true, submittedAt: true },
  });
  const changedMasters = [];
  for (const sub of masters) {
    if (!sub.bookYear || !sub.bookNumber) {
      Object.assign(sub, allocate(sub.mode, invoiceYear(sub.values?.invoice_date, sub.submittedAt, zone)));
      changedMasters.push(sub);
    }
  }
  await write("submission", changedMasters);
  const masterById = new Map(masters.map((r) => [r.id, r]));
  const rows = await tx.customRow.findMany({ orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  const dateColumns = await tx.customColumn.findMany({ where: { code: "invoice_date" }, select: { id: true } });
  const dates = new Map((await tx.customCell.findMany({
    where: { columnId: { in: dateColumns.map((c) => c.id) } }, select: { rowId: true, value: true },
  })).map((c) => [c.rowId, c.value]));
  const used = new Set(rows.filter((r) => r.bookYear && r.bookNumber).map((r) => `${r.mode}:${r.bookYear}:${r.bookNumber}`));
  const changedRows = [];
  const assignRow = (row) => {
    const parent = masterById.get(row.masterId);
    const date = dates.has(row.id) ? dates.get(row.id) : parent?.values?.invoice_date;
    const year = invoiceYear(date, parent?.submittedAt || row.createdAt, zone);
    const inherited = parent?.bookYear === year && !used.has(`${row.mode}:${year}:${parent.bookNumber}`);
    const book = inherited ? { bookYear: year, bookNumber: parent.bookNumber } : allocate(row.mode, year);
    Object.assign(row, book);
    used.add(`${row.mode}:${book.bookYear}:${book.bookNumber}`);
    return row;
  };
  for (const row of rows) {
    if (!row.bookYear || !row.bookNumber) changedRows.push(assignRow(row));
  }
  await write("customRow", changedRows);
  // Keep pre-upgrade Undo/Redo snapshots compatible, including deleted manual rows.
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const history of await tx.customHistory.findMany()) {
    let changed = false;
    for (const entry of [...history.undo, ...history.redo]) for (const change of entry.changes) {
      if (change.table !== "customRow") continue;
      for (const key of ["before", "after"]) {
        const snapshot = change[key];
        if (!snapshot || (snapshot.bookYear && snapshot.bookNumber)) continue;
        const book = byId.get(snapshot.id) || assignRow({ ...snapshot });
        byId.set(snapshot.id, book);
        snapshot.bookYear = book.bookYear; snapshot.bookNumber = book.bookNumber;
        changed = true;
      }
    }
    if (changed) await tx.customHistory.update({ where: { id: history.id }, data: { undo: history.undo, redo: history.redo } });
  }
  for (const [key, value] of counters)
    await tx.counter.upsert({ where: { key }, create: { key, value }, update: { value } });
  await tx.setting.upsert({ where: { key: "bookkeeping_v1" }, create: { key: "bookkeeping_v1", value: true }, update: { value: true } });
}
export async function ensureBookkeeping() {
  await db.$transaction(backfillBooks, { timeout: 180000 });
}
