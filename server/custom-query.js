import { Prisma } from "@prisma/client";
import { db, fail, settings, inTimezone } from "./core.js";
import { bookYearFilter, bookYears } from "./bookkeeping.js";

const provider = process.env.DATABASE_PROVIDER || "sqlite";
// Identifiers below are fixed by this module, never supplied by an HTTP parameter.
const id = (value) => Prisma.raw(provider === "mysql" ? `\`${value}\`` : `"${value}"`);
const col = (alias, field) => Prisma.sql`${id(alias)}.${id(field)}`;
const text = (alias) => {
  const value = col(alias, "value");
  if (provider === "postgresql") return Prisma.sql`(${value} #>> '{}')`;
  if (provider === "mysql") return Prisma.sql`JSON_UNQUOTE(${value})`;
  return Prisma.sql`CAST(json_extract(${value}, '$') AS TEXT)`;
};
export function customOptions(query = {}) {
  const q = String(query.q || "").trim();
  if (q.length > 200) throw fail("Pencarian maksimal 200 karakter", 422);
  const number = (value, fallback, max) => Number.isFinite(Number(value))
    ? Math.max(1, Math.min(max, Math.floor(Number(value) || fallback))) : fallback;
  return {
    q, year: query.year, sort: String(query.sort || ""),
    dir: query.dir === "desc" ? "desc" : "asc",
    page: number(query.page, 1, 1000000), size: number(query.size, 50, 100),
  };
}
export async function customPlan(client, mode, options) {
  const columns = await client.customColumn.findMany({ where: { mode }, orderBy: [{ position: "asc" }, { id: "asc" }] });
  const currentYear = Number(inTimezone(new Date(), (await settings(client)).zona_waktu || "Asia/Jakarta").slice(0, 4));
  const year = bookYearFilter(options.year, currentYear);
  const sortColumn = columns.find((c) => c.id === options.sort);
  if (options.sort && options.sort !== "bookNumber" && !sortColumn)
    throw fail("Kolom pengurutan tidak ditemukan. Pilih urutan nomor buku.", 422);
  const clauses = [Prisma.sql`${col("r", "mode")} = ${mode}`];
  if (year !== null) clauses.push(Prisma.sql`${col("r", "bookYear")} = ${year}`);
  if (options.q) {
    const pattern = "%" + options.q.toLowerCase().replace(/[!%_]/g, "!$&") + "%";
    clauses.push(Prisma.sql`EXISTS (SELECT 1 FROM ${id("custom_cells")} AS ${id("c")}
      WHERE ${col("c", "rowId")} = ${col("r", "id")} AND ${col("c", "mode")} = ${mode}
      AND LOWER(COALESCE(${text("c")}, '')) LIKE ${pattern} ESCAPE '!')`);
  }
  const where = Prisma.join(clauses, " AND ");
  let join = Prisma.empty, sort = Prisma.empty;
  if (sortColumn) {
    join = Prisma.sql`LEFT JOIN ${id("custom_cells")} AS ${id("sc")}
      ON ${col("sc", "rowId")} = ${col("r", "id")} AND ${col("sc", "columnId")} = ${sortColumn.id}
      AND ${col("sc", "mode")} = ${mode}`;
    let value = Prisma.sql`LOWER(COALESCE(${text("sc")}, ''))`;
    if (sortColumn.type === "number") {
      const t = text("sc");
      value = provider === "postgresql"
        ? Prisma.sql`COALESCE(CASE
            WHEN LENGTH(${t}) <= 10000 AND ${t} ~ '^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)([eE][+-]?[0-9]{1,4})?$'
            THEN CASE
              WHEN POSITION('e' IN LOWER(${t})) = 0 THEN CAST(${t} AS NUMERIC)
              WHEN CAST(SPLIT_PART(LOWER(${t}), 'e', 2) AS INTEGER) >= -400 THEN CAST(${t} AS NUMERIC)
              ELSE 0 END
            END, 0)`
        : provider === "mysql" ? Prisma.sql`COALESCE(CAST(${t} AS DECIMAL(30,6)), 0)`
          : Prisma.sql`COALESCE(CAST(${t} AS REAL), 0)`;
    }
    sort = Prisma.sql`${value} ${Prisma.raw(options.dir === "desc" ? "DESC" : "ASC")},`;
  }
  const direction = !sortColumn && options.dir === "desc" ? Prisma.raw("DESC") : Prisma.raw("ASC");
  const order = Prisma.sql`${col("r", "bookYear")} DESC, ${sort}
    ${col("r", "bookNumber")} ${direction}, ${col("r", "createdAt")} ASC, ${col("r", "id")} ASC`;
  return { columns, currentYear, year, where, join, order, mode, options };
}
export async function customRows(client, plan, offset, size) {
  return client.$queryRaw(Prisma.sql`SELECT ${id("r")}.* FROM ${id("custom_rows")} AS ${id("r")}
    ${plan.join} WHERE ${plan.where} ORDER BY ${plan.order} LIMIT ${size} OFFSET ${offset}`);
}
export async function customPage(mode, query) {
  const options = customOptions(query);
  return db.$transaction(async (tx) => {
    const plan = await customPlan(tx, mode, options);
    const counted = await tx.$queryRaw(Prisma.sql`SELECT COUNT(*) AS total FROM ${id("custom_rows")} AS ${id("r")} WHERE ${plan.where}`);
    const total = Number(counted[0].total), page = Math.min(options.page, Math.max(1, Math.ceil(total / options.size)));
    const rows = await customRows(tx, plan, (page - 1) * options.size, options.size);
    const [cells, views, years] = await Promise.all([
      tx.customCell.findMany({ where: { mode, rowId: { in: rows.map((r) => r.id) } } }),
      tx.customView.findMany({ where: { mode } }), bookYears(tx, "customRow", mode),
    ]);
    return { columns: plan.columns, rows, cells, views, total, page, size: options.size,
      year: plan.year, currentYear: plan.currentYear, years };
  }, { isolationLevel: provider === "sqlite" ? "Serializable" : "RepeatableRead", timeout: 30000 });
}
