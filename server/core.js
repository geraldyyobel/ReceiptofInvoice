import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import crypto from "node:crypto";
import path from "node:path";
import { mkdir } from "node:fs/promises";
import sanitizeHtml from "sanitize-html";
import Handlebars from "handlebars";
import { amountTotal } from "../shared/engine.js";
import { publicSettingKeys } from "../shared/email-placeholders.js";
export const db = new PrismaClient({
  transactionOptions: { maxWait: 15000, timeout: 30000 },
});
export const dataDir = path.resolve(process.env.DATA_DIR || "./data");
export const uploadDir = path.join(dataDir, "uploads");
await mkdir(uploadDir, { recursive: true });
const key = process.env.ENCRYPTION_KEY;
if (!/^[a-f\d]{64}$/i.test(key || ""))
  throw Error("ENCRYPTION_KEY harus 64 karakter hex");
if (
  (process.env.SESSION_SECRET || "").length < 48 ||
  process.env.SESSION_SECRET.startsWith("REPLACE")
)
  throw Error("SESSION_SECRET harus acak minimal 48 karakter");
export function encrypt(value) {
  const iv = crypto.randomBytes(12),
    cipher = crypto.createCipheriv("aes-256-gcm", Buffer.from(key, "hex"), iv);
  const data = Buffer.concat([
    cipher.update(Buffer.isBuffer(value) ? value : Buffer.from(value)),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]);
}
export function decrypt(data) {
  const d = crypto.createDecipheriv(
    "aes-256-gcm",
    Buffer.from(key, "hex"),
    data.subarray(0, 12),
  );
  d.setAuthTag(data.subarray(12, 28));
  return Buffer.concat([d.update(data.subarray(28)), d.final()]);
}
export const hash = (s) =>
  crypto
    .createHmac("sha256", process.env.SESSION_SECRET)
    .update(s)
    .digest("hex");
export const random = () => crypto.randomBytes(32).toString("base64url");
export const equal = (a, b) => {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const left = Buffer.from(a),
    right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
};
export const fail = (message, status = 400, details) =>
  Object.assign(new Error(message), { status, details });
export async function settings(client = db) {
  return Object.fromEntries(
    (await client.setting.findMany()).map((x) => [x.key, x.value]),
  );
}
export async function audit(
  req,
  action,
  before = null,
  after = null,
  mode = req?.mode || req?.session?.mode || null,
  client = db,
) {
  await client.activityLog.create({
    data: {
      mode,
      actor: req?.admin?.email || "publik",
      action,
      ip: req?.ip || "scheduler",
      before: before ?? undefined,
      after: after ?? undefined,
    },
  });
}
const cssProperties = [
  "display",
  "min-width",
  "color",
  "background-color",
  "font-size",
  "font-family",
  "font-weight",
  "font-style",
  "text-decoration",
  "text-align",
  "line-height",
  "padding",
  "padding-left",
  "padding-right",
  "padding-top",
  "padding-bottom",
  "margin",
  "margin-left",
  "margin-right",
  "margin-top",
  "margin-bottom",
  "width",
  "height",
  "max-width",
  "border",
  "border-collapse",
  "vertical-align",
];
export function cleanHtml(html, template = false, { rejectPendingImages = false } = {}) {
  if (typeof html !== "string" || html.length > 1500000)
    throw fail("HTML tidak valid/terlalu besar");
  if (template) {
    if (
      /<style\b[^>]*>[\s\S]*?\{\{[\s\S]*?<\/style\s*>/i.test(html) ||
      /<[^>]*\{\{[^>]*>/i.test(html)
    )
      throw fail(
        "Placeholder hanya boleh ditempatkan pada teks dokumen, bukan tag, atribut atau CSS",
      );
    if (
      /\{\{\{|\{\{&|@\{|\\|url\s*\(|expression\s*\(|@import|behavior\s*:|-moz-binding/i.test(
        html,
      )
    )
      throw fail("Template mengandung ekspresi/URL CSS yang tidak aman");
    for (const m of html.matchAll(/\{\{([\s\S]*?)\}\}/g))
      if (
        !/^\s*(?:[a-z][\w.]*(?:\s*)|format_number\s+[a-z][\w.]*\s*|format_date\s+[a-z][\w.]*\s+['"]dd-MM-yyyy['"]\s*)$/.test(
          m[1],
        )
      )
        throw fail("Gunakan placeholder dan helper yang didukung");
  }
  const sanitized = sanitizeHtml(html, {
    allowedTags: [
      ...sanitizeHtml.defaults.allowedTags,
      "img",
      "u",
      "s",
      "span",
      "hr",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      ...(template ? ["html", "head", "body", "meta", "title", "style"] : []),
    ],
    allowedAttributes: {
      "*": ["style", "class", "colspan", "rowspan"],
      a: ["href", "title", "target", "rel"],
      img: ["src", "alt", "width", "height"],
      meta: ["charset"],
      html: ["lang"],
    },
    allowedStyles: {
      "*": Object.fromEntries(
        cssProperties.map((p) => [p, [/^[\w\s#(),.%+\-"';:]+$/]]),
      ),
    },
    allowedSchemes: ["https", "mailto"],
    allowProtocolRelative: false,
    exclusiveFilter: (frame) =>
      frame.tag === "img" &&
      !/^\/uploads\/[a-zA-Z0-9-]+\.(png|jpg|webp)$/.test(
        frame.attribs.src || "",
      ),
    transformTags: {
      img: (tagName, attribs) => {
        if (rejectPendingImages && /^(?:blob|data):/i.test((attribs.src || "").trim()))
          throw fail("Gambar belum selesai diunggah. Tunggu unggahan selesai sebelum menyimpan ketentuan.", 422);
        // Older TinyMCE versions stored application upload URLs relative to the admin page.
        const src = (attribs.src || "").trim();
        if (/^(?:\.\.?\/)*uploads\/[a-zA-Z0-9-]+\.(png|jpg|webp)$/.test(src))
          attribs.src = "/" + src.replace(/^(?:\.\.?\/)*/, "");
        return { tagName, attribs };
      },
      a: sanitizeHtml.simpleTransform("a", { rel: "noopener noreferrer" }),
    },
    allowVulnerableTags: template,
  });
  return template ? "<!DOCTYPE html>\n" + sanitized : sanitized;
}
Handlebars.registerHelper("format_number", (v) =>
  new Intl.NumberFormat("id-ID", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(v) || 0),
);
Handlebars.registerHelper("format_date", (v) => {
  if (!v || !Number.isFinite(Date.parse(v))) return "-";
  const [y, m, d] = String(v).slice(0, 10).split("-");
  return `${d}-${m}-${y}`;
});
export function templateData(values, reference, s, year, book = {}) {
  const documentSettings = Object.fromEntries(
    publicSettingKeys
      .filter((key) => Object.hasOwn(s || {}, key))
      .map((key) => [key, s[key]]),
  );
  return {
    ...values,
    total: amountTotal(values.amount_nett, values.vat),
    nomor_referensi: reference,
    nomor_buku: Number.isInteger(book.bookNumber) && book.bookNumber > 0 ? book.bookNumber : "-",
    tahun_buku: Number.isInteger(book.bookYear) && book.bookYear > 0 ? book.bookYear : "-",
    tahun: year,
    setting: documentSettings,
  };
}
export function renderHtml(template, values, reference, s, year, book = {}) {
  const data = templateData(values, reference, s, year, book);
  return Handlebars.compile(cleanHtml(template, true), { strict: false })(data);
}
export const inTimezone = (date, tz) =>
  new Intl.DateTimeFormat("sv-SE", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
export function startOfDay(date, tz) {
  return startOfDate(inTimezone(date, tz).slice(0, 10), tz);
}
export function startOfDate(day, tz) {
  const nominal = Date.parse(day + "T00:00:00Z");
  let actual = nominal;
  for (let i = 0; i < 3; i++) {
    const local = Date.parse(
      inTimezone(new Date(actual), tz).replace(" ", "T") + ":00Z",
    );
    actual += nominal - local;
  }
  return new Date(actual);
}
export function referenceNumber(format, mode, year, seq) {
  return format
    .replaceAll("{MODE}", mode === "internal" ? "INT" : "EKS")
    .replaceAll("{YEAR}", String(year))
    .replace(/\{SEQ:(\d)\}/g, (_, n) => String(seq).padStart(Number(n), "0"));
}
