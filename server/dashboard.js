import { Prisma } from "@prisma/client";
import { db, settings, inTimezone, fail } from "./core.js";
import { bookYearFilter, bookYears } from "./bookkeeping.js";
import { validDate } from "../shared/date-limits.js";

const dayShift = (day, offset) => new Date(Date.parse(day + "T00:00:00Z") + offset * 86400000).toISOString().slice(0, 10);
const text = (v) => typeof v === "string" ? v.trim().replace(/\s+/g, " ") : "";
const yes = (v) => text(v).toLowerCase() === "ya";
export const needsLegality = (v) => text(v.legalitas_terkirim).toLowerCase() === "belum";

// Work in minor units to avoid accumulating binary floating-point rounding errors.
function minor(v) {
  const s = String(v ?? "0").trim();
  const m = s.match(/^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/);
  if (!m || !(m[2] + (m[3] || "")).length || !Number.isFinite(Number(s)) || s.length > 1000) return 0n;
  const shift = 2 + Number(m[4] || 0) - (m[3] || "").length;
  if (Math.abs(shift) > 1300) return 0n;
  let n = BigInt(m[2] + (m[3] || ""));
  if (shift >= 0) n *= 10n ** BigInt(shift);
  else { const divisor = 10n ** BigInt(-shift); n = n / divisor + (n % divisor * 2n >= divisor ? 1n : 0n); }
  return m[1] === "-" ? -n : n;
}
const decimal = (n) => `${n < 0n ? "-" : ""}${(n < 0n ? -n : n) / 100n}.${String((n < 0n ? -n : n) % 100n).padStart(2, "0")}`;
const currencyKey = (v) => text(v).toUpperCase() || "Tidak diisi";
const amount = (v) => minor(v.amount_nett) + minor(v.vat);

export async function dashboard(mode, requestedYear, now = new Date()) {
  const s = await settings(), zone = s.zona_waktu || "Asia/Jakarta";
  const todayKey = inTimezone(now, zone).slice(0, 10), currentYear = Number(todayKey.slice(0, 4));
  const dayFormatter = new Intl.DateTimeFormat("sv-SE", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" });
  const weekStart = dayShift(todayKey, -6);
  const year = bookYearFilter(requestedYear ?? "current", currentYear);
  if (year === null) throw fail("Pilih satu tahun buku untuk Ringkasan", 422);
  const daily = Array.from({ length: 30 }, (_, i) => ({ key: dayShift(todayKey, i - 29), count: 0 }));
  const dailyMap = new Map(daily.map((d) => [d.key, d]));
  const monthly = Array.from({ length: 12 }, (_, i) => ({ key: `${year}-${String(i + 1).padStart(2, "0")}`, count: 0 }));
  const vendors = new Map(), currencies = new Map(), sources = new Map();
  const compositions = Object.fromEntries(["vat", "service", "subvendor"].map((key) => [key, { yes: 0, no: 0, unknown: 0 }]));
  let total = 0, today = 0, last7 = 0, durationSum = 0, durationCount = 0, failed = 0, sent = 0;
  let legalityCount = 0, failedCount = 0, cursor;
  const legality = [], failedEmails = [];
  do {
    // Bounded memory; never send individual answers or the full year's rows to the browser.
    const rows = await db.submission.findMany({ where: { mode, bookYear: year }, take: 500,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), orderBy: { id: "asc" },
      select: { id: true, reference: true, vendor: true, values: true, submittedAt: true, startedAt: true } });
    if (!rows.length) break;
    const emails = await db.emailLog.findMany({ where: { mode, submissionId: { in: rows.map((r) => r.id) } },
      select: { submissionId: true, status: true }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
    const latest = new Map();
    for (const email of emails) {
      if (!latest.has(email.submissionId)) latest.set(email.submissionId, email.status);
      if (email.status === "gagal") failed++; else if (email.status === "terkirim") sent++;
    }
    for (const r of rows) {
      const v = r.values || {}, day = dayFormatter.format(r.submittedAt);
      total++; if (day === todayKey) today++;
      if (day >= weekStart && day <= todayKey) last7++;
      if (dailyMap.has(day)) dailyMap.get(day).count++;
      const month = validDate(v.invoice_date) ? Number(v.invoice_date.slice(5, 7)) : Number(day.slice(5, 7));
      if (month >= 1 && month <= 12) monthly[month - 1].count++;
      const ms = +r.submittedAt - +r.startedAt;
      if (Number.isFinite(ms) && ms >= 0) { durationSum += ms; durationCount++; }
      const vendorName = text(r.vendor) || text(v.received_from) || "Tidak diisi";
      const vendorKey = vendorName.toLocaleLowerCase("id-ID");
      if (!vendors.has(vendorKey)) vendors.set(vendorKey, { name: vendorName, count: 0, currencies: new Map(), counts: new Map() });
      const vendor = vendors.get(vendorKey), currency = currencyKey(v.currency), value = amount(v);
      vendor.count++;
      vendor.counts.set(currency, (vendor.counts.get(currency) || 0) + 1);
      vendor.currencies.set(currency, (vendor.currencies.get(currency) || 0n) + value);
      currencies.set(currency, (currencies.get(currency) || 0n) + value);
      for (const [key, answer] of [["vat", v.ada_ppn], ["service", v.invoice_jasa]])
        compositions[key][yes(answer) ? "yes" : text(answer).toLowerCase() === "tidak" ? "no" : "unknown"]++;
      const subAnswers = [1, 2, 3, 4].map((i) => v[`ada_subvendor_${i}`]);
      compositions.subvendor[subAnswers.some(yes) ? "yes" : text(subAnswers[0]).toLowerCase() === "tidak" ? "no" : "unknown"]++;
      const source = text(v.permintaan_via) || "Tidak diisi";
      const sourceKey = source.toLocaleLowerCase("id-ID");
      if (!sources.has(sourceKey)) sources.set(sourceKey, { name: source, count: 0 });
      sources.get(sourceKey).count++;
      const item = { id: r.id, reference: r.reference, vendor: vendorName, submittedAt: r.submittedAt };
      const pushLatest = (list) => { list.push(item); list.sort((a, b) => +b.submittedAt - +a.submittedAt || a.id.localeCompare(b.id)); if (list.length > 5) list.pop(); };
      if (needsLegality(v)) { legalityCount++; pushLatest(legality); }
      if (latest.get(r.id) === "gagal") { failedCount++; pushLatest(failedEmails); }
    }
    cursor = rows.at(-1).id;
    if (rows.length < 500) break;
  } while (true);
  const serialize = (map) => [...map].sort(([a], [b]) => a.localeCompare(b)).map(([currency, n]) => ({ currency, total: decimal(n) }));
  const topByValue = [...currencies.keys()].sort().map((currency) => ({ currency,
    vendors: [...vendors.values()].filter((v) => v.currencies.has(currency))
      .sort((a, b) => {
        const x = a.currencies.get(currency), y = b.currencies.get(currency);
        return x > y ? -1 : x < y ? 1 : a.name.localeCompare(b.name);
      }).slice(0, 10).map((v) => ({ name: v.name, count: v.counts.get(currency), total: decimal(v.currencies.get(currency)) })) }));
  return { year, currentYear, years: await bookYears(db, "submission", mode), zone, total, today, last7,
    vendors: [...vendors.keys()].filter((k) => k !== "tidak diisi").length, failed,
    daily, monthly, currencies: serialize(currencies),
    topByValue, topVendors: [...vendors.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, 10)
      .map((v) => ({ name: v.name, count: v.count, currencies: serialize(v.currencies) })),
    compositions, sources: [...sources.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    emails: { sent, failed }, duration: { averageSeconds: durationCount ? durationSum / durationCount / 1000 : null, valid: durationCount, excluded: total - durationCount },
    followups: { legality: { count: legalityCount, rows: legality }, email: { count: failedCount, rows: failedEmails } } };
}

// Portable, parameterized predicates for the Data Form follow-up links.
export function followupPredicate(kind) {
  const mysql = process.env.DATABASE_PROVIDER === "mysql";
  const col = (name) => Prisma.raw(mysql ? `s.\`${name}\`` : `s."${name}"`);
  if (kind === "legality") {
    const json = process.env.DATABASE_PROVIDER === "postgresql"
      ? Prisma.sql`${col("values")}->>'legalitas_terkirim'`
      : mysql ? Prisma.sql`JSON_UNQUOTE(JSON_EXTRACT(${col("values")}, '$.legalitas_terkirim'))`
      : Prisma.sql`json_extract(${col("values")}, '$.legalitas_terkirim')`;
    return Prisma.sql`LOWER(TRIM(${json})) = 'belum'`;
  }
  if (kind === "email") {
    const q = (n) => Prisma.raw(mysql ? `\`${n}\`` : `"${n}"`);
    return Prisma.sql`(SELECT e.status FROM email_logs e WHERE e.mode = ${col("mode")} AND e.${q("submissionId")} = s.id
      ORDER BY e.${q("createdAt")} DESC, e.id DESC LIMIT 1) = 'gagal'`;
  }
  throw fail("Filter tindak lanjut tidak valid", 422);
}

export async function followupSelection(where, kind, { skip = 0, take, sort = "submittedAt", dir = "desc" } = {}) {
  const mysql = process.env.DATABASE_PROVIDER === "mysql";
  const col = (name) => Prisma.raw(mysql ? `s.\`${name}\`` : `s."${name}"`);
  const conditions = [Prisma.sql`s.mode = ${where.mode}`, followupPredicate(kind)];
  if (where.bookYear) conditions.push(Prisma.sql`${col("bookYear")} = ${where.bookYear}`);
  const contains = (name, value) => Prisma.sql`LOWER(${col(name)}) LIKE ${"%" + value.toLowerCase().replace(/[!%_]/g, (c) => "!" + c) + "%"} ESCAPE '!'`;
  if (where.vendor) conditions.push(contains("vendor", where.vendor.contains));
  if (where.status) conditions.push(Prisma.sql`s.status = ${where.status}`);
  if (where.OR) conditions.push(Prisma.sql`(${Prisma.join(where.OR.map((r) => {
    const [key, filter] = Object.entries(r)[0]; return contains(key, filter.contains);
  }), " OR ")})`);
  if (where.submittedAt?.gte) conditions.push(Prisma.sql`${col("submittedAt")} >= ${where.submittedAt.gte}`);
  if (where.submittedAt?.lte) conditions.push(Prisma.sql`${col("submittedAt")} <= ${where.submittedAt.lte}`);
  const clause = Prisma.sql`FROM submissions s WHERE ${Prisma.join(conditions, " AND ")}`;
  const sortCol = col(["reference", "vendor", "submittedAt", "status", "bookNumber"].includes(sort) ? sort : "submittedAt");
  const direction = Prisma.raw(dir === "asc" ? "ASC" : "DESC");
  const rows = await db.$queryRaw(Prisma.sql`SELECT s.id ${clause} ORDER BY ${col("bookYear")} DESC, ${sortCol} ${direction}, s.id ASC
    ${take !== undefined ? Prisma.sql`LIMIT ${take} OFFSET ${skip}` : Prisma.empty}`);
  const [count] = await db.$queryRaw(Prisma.sql`SELECT COUNT(*) AS total ${clause}`);
  return { ids: rows.map((r) => r.id), total: Number(count.total) };
}
