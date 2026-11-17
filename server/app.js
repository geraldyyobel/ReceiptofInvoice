import { registerNotifications } from "./notifications.js";
import express from "express";
import {
  beginMailConnection,
  claimMailFlow,
  completeMailConnection,
  disconnectMail,
  mailConnectionStatus,
  mailOrigin,
  oauthCookie,
  oauthCookieOptions,
  safeMailSettings,
} from "./mail-oauth.js";
import { termsVisibility, visibilityKey, checkTermsConsent } from "./terms.js";
import { fieldsForTerms } from "../shared/terms.js";
import { appendMasterRows, schemaKey } from "./custom-sync.js";
import { registerCustomEditingRoutes } from "./custom-editing.js";
import { customHistoryStatus } from "./custom-history.js";
import { customBackupSnapshot } from "./custom-backups.js";
import { customPage } from "./custom-query.js";
import { exportCustom } from "./custom-export.js";
import { nextBookNumber, invoiceYear, bookYearFilter, bookYears } from "./bookkeeping.js";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import { rateLimit } from "express-rate-limit";
import bcrypt from "bcryptjs";
import multer from "multer";
import crypto from "node:crypto";
import path from "node:path";
import { writeFile, readFile, unlink } from "node:fs/promises";
import ExcelJS from "exceljs";
import { z } from "zod";
import {
  db,
  uploadDir,
  settings,
  hash,
  random,
  equal,
  fail,
  audit,
  encrypt,
  cleanHtml,
  renderHtml,
  inTimezone,
  startOfDay,
  startOfDate,
  referenceNumber,
} from "./core.js";
import {
  validateDefinition,
  validateAnswers,
  EMAIL,
  amountTotal,
} from "../shared/engine.js";
import { assumptions } from "../prisma/initial.js";
import { documentFor, pdfBuffer, sendMail } from "./documents.js";
import {
  maintenance,
  createBackup,
  restoreBackup,
  backupPath,
  archivePath,
} from "./backup.js";
export const app = express();
app.disable("x-powered-by");
app.set("trust proxy", Number(process.env.TRUST_PROXY || 0));
const production = process.env.NODE_ENV === "production";
const origins = (process.env.APP_ORIGIN || "http://localhost:5173").split(",");
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "blob:"],
        connectSrc: ["'self'"],
        frameSrc: ["'self'", "blob:"],
        fontSrc: ["'self'", "data:"],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: production ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false,
  }),
);
app.use(
  cors({
    origin: (origin, cb) => cb(null, !origin || origins.includes(origin)),
    credentials: true,
  }),
);
app.use(express.json({ limit: "3mb" }));
app.use(cookieParser(process.env.SESSION_SECRET));
const cookieOptions = {
  httpOnly: true,
  sameSite: "strict",
  secure: production,
  path: "/",
  signed: true,
};
app.use(async (req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  if (
    maintenance.busy &&
    req.path.startsWith("/api") &&
    !req.path.endsWith("/health")
  )
    return next(
      fail("Pemeliharaan backup/restore sedang berjalan. Coba kembali.", 503),
    );
  try {
    if (req.path.startsWith("/api")) {
      maintenance.active++;
      req.tracked = true;
      let done = false;
      const finish = () => {
        if (!done) {
          maintenance.active--;
          done = true;
        }
      };
      res.once("finish", finish);
      res.once("close", finish);
    }
    const sid = req.signedCookies.roi_session;
    if (sid) {
      const session = await db.session.findUnique({ where: { id: hash(sid) } });
      if (session && session.expiresAt > new Date()) {
        const admin = await db.admin.findUnique({
          where: { id: session.adminId },
        });
        if (admin?.active) {
          req.session = session;
          req.admin = admin;
          req.mode = session.mode;
        }
      }
    }
    next();
  } catch (e) {
    next(e);
  }
});
app.use("/api", (req, res, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const origin = req.headers.origin;
  if (origin && !origins.includes(origin))
    return next(fail("Origin tidak diizinkan", 403));
  if (!equal(req.signedCookies.roi_csrf, req.headers["x-csrf-token"]))
    return next(fail("Token CSRF tidak valid; muat ulang halaman", 403));
  next();
});
const limiter = (key, minutes, fallback) =>
  rateLimit({
    windowMs: minutes * 60000,
    limit: async () => Number((await settings())[key]) || fallback,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Terlalu banyak percobaan. Coba lagi beberapa saat." },
  });
app.get("/api/health", async (req, res) => {
  await db.$queryRaw`SELECT 1`;
  res.json({ ok: true });
});
app.get("/api/csrf", (req, res) => {
  const token = req.signedCookies.roi_csrf || random();
  res.cookie("roi_csrf", token, { ...cookieOptions, maxAge: 86400000 });
  res.json({ token });
});
app.get("/api/public/config", async (req, res) => {
  const s = await settings();
  res.json({
    nama_aplikasi: s.nama_aplikasi,
    nama_perusahaan: s.nama_perusahaan,
    logo: s.logo,
    zona_waktu: s.zona_waktu,
    tema_internal: s.tema_internal,
    tema_eksternal: s.tema_eksternal,
    aksen_internal: s.aksen_internal,
    aksen_eksternal: s.aksen_eksternal,
    tinyLicense: process.env.TINY_LICENSE_KEY || "gpl",
  });
});
app.post("/api/auth/login", limiter("login_limit", 15, 5), async (req, res) => {
  const email = String(req.body.email || "")
      .toLowerCase()
      .trim(),
    password = String(req.body.password || "");
  if (Buffer.byteLength(password, "utf8") > 72)
    throw fail(
      "Password maksimal 72 byte UTF-8. Jika password lama lebih panjang, minta Super Admin mengaturnya ulang.",
      422,
    );
  const admin = await db.admin.findUnique({ where: { email } });
  const valid = await bcrypt.compare(
    password,
    admin?.password ||
      "$2b$12$R9h/cIPz0gi.URNNX3kh2OPST9/PgBkqquzi.Ss7KIUgO2t0jWMUW",
  );
  if (!admin?.active || !valid) {
    await audit(req, "auth.login_failed", null, { email }, null);
    throw fail("Email atau password salah", 401);
  }
  if (req.session) await db.session.delete({ where: { id: req.session.id } });
  const s = await settings(),
    token = random(),
    expiresAt = new Date(Date.now() + Number(s.session_hours) * 3600000);
  await db.session.create({
    data: { id: hash(token), adminId: admin.id, csrf: random(), expiresAt },
  });
  req.admin = admin;
  await audit(req, "auth.login", null, null, null);
  res
    .cookie("roi_session", token, { ...cookieOptions, expires: expiresAt })
    .json({
      admin: { id: admin.id, name: admin.name, email, role: admin.role },
      mode: null,
    });
});
app.get("/api/auth/me", (req, res) =>
  res.json({
    admin: req.admin
      ? {
          id: req.admin.id,
          name: req.admin.name,
          email: req.admin.email,
          role: req.admin.role,
        }
      : null,
    mode: req.mode || null,
  }),
);
app.post("/api/auth/logout", async (req, res) => {
  if (req.session) {
    await db.session.delete({ where: { id: req.session.id } });
    await audit(req, "auth.logout");
  }
  res.clearCookie("roi_session", { path: "/" }).json({ ok: true });
});
const admin = (req, res, next) =>
  req.admin ? next() : next(fail("Silakan login admin", 401));
const superadmin = (req, res, next) =>
  req.admin?.role === "superadmin"
    ? next()
    : next(fail("Khusus Super Admin", 403));
const mode = (req, res, next) =>
  ["internal", "eksternal"].includes(req.mode)
    ? next()
    : next(fail("Pilih mode terlebih dahulu", 409));
// The provider returns via a cross-site top-level GET. A separate Lax cookie
// binds this callback; the original Super Admin session is checked in the DB.
app.get(
  "/api/email/oauth/:provider/callback",
  rateLimit({ windowMs: 900000, limit: 30, legacyHeaders: false }),
  async (req, res) => {
    const provider = z.enum(["gmail", "outlook"]).parse(req.params.provider);
    let outcome = "error";
    try {
      const flow = await claimMailFlow(
        provider,
        req.query.state,
        req.signedCookies[oauthCookie],
      );
      req.admin = flow.admin;
      if (req.query.error) {
        outcome = "denied";
        throw fail("Login email dibatalkan.", 400);
      }
      await completeMailConnection(flow, req.query.code, req);
      outcome = "success";
    } catch {
      await audit(req, "mail.oauth.failed", null, { provider, outcome }, null);
    }
    res.clearCookie(oauthCookie, {
      path: oauthCookieOptions.path,
      httpOnly: true,
      sameSite: "lax",
      secure: oauthCookieOptions.secure,
    });
    res.redirect(mailOrigin() + "/admin?mail_oauth=" + outcome);
  },
);
app.use("/api/admin", admin);
app.post("/api/admin/mode", async (req, res) => {
  const m = z.enum(["internal", "eksternal"]).parse(req.body.mode);
  await db.session.update({ where: { id: req.session.id }, data: { mode: m } });
  req.mode = m;
  await audit(req, "mode.select", null, { mode: m });
  res.json({ mode: m });
});
app.get("/api/public/:mode/form", async (req, res) => {
  const mode = z.enum(["internal", "eksternal"]).parse(req.params.mode);
  const f = await db.form.findUnique({ where: { mode } }),
    t = await db.term.findUnique({ where: { mode } });
  const version = await db.formVersion.findUnique({
      where: { id: f.currentId },
    }),
    terms = await db.termsVersion.findUnique({ where: { id: t.publishedId } });
  const visibility = await termsVisibility(mode);
  res.json({
    form: {
      ...version,
      fields: fieldsForTerms(version.fields, visibility.enabled),
    },
    terms: visibility.enabled ? terms : null,
    termsVersionId: t.publishedId,
    termsEnabled: visibility.enabled,
    termsRevision: visibility.revision,
    mode,
  });
});
app.post(
  "/api/public/:mode/submit",
  limiter("public_limit", 60, 30),
  async (req, res) => {
    const mode = z.enum(["internal", "eksternal"]).parse(req.params.mode);
    const b = z
      .object({
        formVersionId: z.string(),
        termsVersionId: z.string(),
        accepted: z.boolean(),
        termsRevision: z.number().int().nonnegative().default(0),
        startedAt: z.iso.datetime(),
        values: z.record(z.string(), z.unknown()),
      })
      .parse(req.body);
    const form = await db.formVersion.findFirst({
        where: { id: b.formVersionId, mode },
      }),
      current = await db.form.findUnique({ where: { mode } }),
      term = await db.term.findUnique({ where: { mode } });
    if (
      !form ||
      current.currentId !== form.id ||
      term.publishedId !== b.termsVersionId
    )
      throw fail(
        "Form/ketentuan sudah diperbarui. Muat ulang dan tinjau kembali sebelum mengirim.",
        409,
      );
    const visibility = await termsVisibility(mode);
    checkTermsConsent(visibility, b);
    const v = validateAnswers(
      fieldsForTerms(form.fields, visibility.enabled),
      b.values,
      form.sections,
      { timeZone: (await settings()).zona_waktu },
    );
    if (!v.valid) throw fail("Periksa kembali isian form", 422, v.errors);
    for (const f of v.visible.filter(
      (f) => f.type === "file" && v.values[f.code],
    )) {
      const [id, token] = String(v.values[f.code]).split(":");
      const u = await db.upload.findFirst({
        where: { id, mode, public: false },
      });
      if (!u || !equal(hash(id), token)) throw fail("Upload tidak valid", 422);
    }
    const start = new Date(b.startedAt);
    if (start > new Date() || start < new Date(Date.now() - 30 * 86400000))
      throw fail("Draft sudah kedaluwarsa; mulai ulang form");
    const token = random();
    const sub = await db.$transaction(
      async (tx) => {
        // Read version pointers in the same transaction as insert to avoid a publish race.
        const currentVisibility = await termsVisibility(mode, tx);
        checkTermsConsent(currentVisibility, b);
        if (
          (await tx.form.findUnique({ where: { mode } })).currentId !==
            form.id ||
          (await tx.term.findUnique({ where: { mode } })).publishedId !==
            b.termsVersionId
        )
          throw fail("Versi form berubah. Muat ulang.", 409);
        const s = await settings(tx),
          year = Number(inTimezone(new Date(), s.zona_waktu).slice(0, 4));
        const seq = await tx.counter.upsert({
          where: { key: `${mode}:${year}` },
          create: { key: `${mode}:${year}`, value: 1 },
          update: { value: { increment: 1 } },
        });
        const reference = referenceNumber(
            s.format_nomor,
            mode,
            year,
            seq.value,
          ),
          doc = await tx.docTemplate.findUnique({ where: { mode } });
        const documentSettings = Object.fromEntries(
          [
            "nama_perusahaan",
            "kop",
            "penerima_nama",
            "kode_form",
            "zona_waktu",
            "logo",
          ].map((k) => [k, s[k]]),
        );
        const sub = await tx.submission.create({
          data: {
            mode,
            ...(await nextBookNumber(tx, mode, invoiceYear(v.values.invoice_date, new Date(), s.zona_waktu))),
            reference,
            tokenHash: hash(token),
            formVersionId: form.id,
            termsVersionId: b.termsVersionId,
            templateVersionId: doc.currentId,
            documentSettings: {
              ...documentSettings,
              termsEnabled: currentVisibility.enabled,
              termsAccepted: currentVisibility.enabled && b.accepted,
              termsRevision: currentVisibility.revision,
            },
            startedAt: start,
            vendor: String(v.values.received_from || ""),
            email: String(v.values.email_anda || ""),
            values: {
              ...v.values,
              total: amountTotal(v.values.amount_nett, v.values.vat),
            },
          },
        });
        await tx.submissionValue.createMany({
          data: Object.entries(v.values).map(([code, value]) => ({
            submissionId: sub.id,
            code,
            value,
          })),
        });
        const synced = await appendMasterRows(tx, mode, [sub]);
        await audit(
          req,
          "custom.auto_sync",
          null,
          { ...synced, submissionId: sub.id },
          mode,
          tx,
        );
        await audit(
          req,
          "submission.create",
          null,
          { id: sub.id, reference },
          mode,
          tx,
        );
        return sub;
      },
      { timeout: 20000 },
    );
    res
      .status(201)
      .json({ id: sub.id, reference: sub.reference, token, email: sub.email });
  },
);
async function authorizedSubmission(req) {
  const sub = await db.submission.findUnique({ where: { id: req.params.id } });
  if (!sub) throw fail("Dokumen tidak ditemukan", 404);
  if (req.path.startsWith("/api/admin")) {
    if (sub.mode !== req.mode)
      throw fail("Dokumen tidak ditemukan dalam mode ini", 404);
  } else if (
    !equal(sub.tokenHash, hash(String(req.headers["x-document-token"] || "")))
  )
    throw fail("Akses dokumen tidak diizinkan", 403);
  return sub;
}
async function download(req, res) {
  const sub = await authorizedSubmission(req),
    html = await documentFor(sub),
    isPdf = req.params.format === "pdf";
  if (!["pdf", "html"].includes(req.params.format))
    throw fail("Format tidak dikenal");
  const bytes = isPdf ? await pdfBuffer(html) : Buffer.from(html);
  await audit(
    req,
    "document.download",
    null,
    { submissionId: sub.id, format: req.params.format },
    sub.mode,
  );
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${sub.reference}.${req.params.format}"`,
  );
  res.type(isPdf ? "application/pdf" : "text/html").send(bytes);
}
app.get(
  "/api/public/submissions/:id/document/:format",
  limiter("public_limit", 60, 30),
  download,
);
app.post(
  "/api/public/submissions/:id/email",
  limiter("email_limit", 60, 5),
  async (req, res) => {
    const sub = await authorizedSubmission(req),
      recipient = z.email().parse(req.body.email);
    res.json(await sendMail({ recipient, sub, req }));
  },
);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 1 },
});
function detectedMime(b) {
  if (b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    return ["image/png", "png"];
  if (b[0] === 255 && b[1] === 216 && b[2] === 255)
    return ["image/jpeg", "jpg"];
  if (
    b.subarray(0, 4).toString() === "RIFF" &&
    b.subarray(8, 12).toString() === "WEBP"
  )
    return ["image/webp", "webp"];
  if (b.subarray(0, 5).toString() === "%PDF-")
    return ["application/pdf", "pdf"];
  return [];
}
async function saveUpload(req, res, isPublic) {
  const s = await settings(),
    file = req.file;
  if (!file) throw fail("Pilih file terlebih dahulu");
  const [mime, ext] = detectedMime(file.buffer);
  if (
    !mime ||
    mime !== file.mimetype ||
    !s.upload_types.includes(mime) ||
    (isPublic && !mime.startsWith("image/")) ||
    file.size > Number(s.upload_mb) * 1024 * 1024
  )
    throw fail("Tipe atau ukuran file tidak diizinkan");
  const mode = isPublic
    ? req.mode
    : z.enum(["internal", "eksternal"]).parse(req.params.mode);
  const filename = crypto.randomUUID() + "." + ext;
  await writeFile(path.join(uploadDir, filename), file.buffer, { flag: "wx" });
  const u = await db.upload.create({
    data: {
      mode,
      filename,
      mime,
      size: file.size,
      originalName: path.basename(file.originalname),
      public: isPublic,
    },
  });
  await audit(req, "upload.create", null, { id: u.id, size: u.size }, mode);
  res.json({
    id: u.id,
    value: `${u.id}:${hash(u.id)}`,
    location: `/uploads/${filename}`,
    name: u.originalName,
  });
}
app.post(
  "/api/public/:mode/upload",
  limiter("public_limit", 60, 30),
  upload.single("file"),
  (req, res) => saveUpload(req, res, false),
);
app.get("/uploads/:filename", async (req, res) => {
  const u = await db.upload.findFirst({
    where: { filename: req.params.filename, public: true },
  });
  if (!u) throw fail("Gambar tidak ditemukan", 404);
  res.type(u.mime).sendFile(path.join(uploadDir, u.filename));
});
app.use("/api/admin", mode);
registerNotifications(app);
app.post("/api/admin/uploads", upload.single("file"), (req, res) =>
  saveUpload(req, res, true),
);
app.get("/api/admin/uploads/:id", async (req, res) => {
  const u = await db.upload.findFirst({
    where: { id: req.params.id, mode: req.mode },
  });
  if (!u) throw fail("File tidak ditemukan", 404);
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="file.${u.filename.split(".").pop()}"`,
  );
  res.type(u.mime).sendFile(path.join(uploadDir, u.filename));
});
const pageParams = (req) => ({
  page: Math.max(1, Math.min(100000, Math.floor(Number(req.query.page) || 1))),
  size: Math.max(1, Math.min(100, Math.floor(Number(req.query.size) || 20))),
});
function dateFilter(q, tz = "Asia/Jakarta") {
  const r = {};
  for (const [key, op] of [
    ["from", "gte"],
    ["to", "lte"],
  ])
    if (q[key]) {
      const day = String(q[key]),
        test = new Date(day + "T00:00:00Z");
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
        !Number.isFinite(+test) ||
        test.toISOString().slice(0, 10) !== day
      )
        throw fail("Filter tanggal tidak valid");
      r[op] =
        key === "to"
          ? new Date(
              +startOfDate(
                new Date(+test + 86400000).toISOString().slice(0, 10),
                tz,
              ) - 1,
            )
          : startOfDate(day, tz);
    }
  return Object.keys(r).length ? r : undefined;
}
const textSearch = (value) => ({
  contains: String(value),
  ...(process.env.DATABASE_PROVIDER === "postgresql"
    ? { mode: "insensitive" }
    : {}),
});
async function submissionWhere(req) {
  const tz = (await settings()).zona_waktu;
  const year = bookYearFilter(req.query.year, Number(inTimezone(new Date(), tz).slice(0, 4)));
  return {
    mode: req.mode,
    ...(year !== null ? { bookYear: year } : {}),
    ...(req.query.q
      ? {
          OR: ["reference", "vendor", "email"].map((k) => ({
            [k]: textSearch(req.query.q),
          })),
        }
      : {}),
    ...(req.query.vendor ? { vendor: textSearch(req.query.vendor) } : {}),
    ...(req.query.status ? { status: String(req.query.status) } : {}),
    submittedAt: dateFilter(req.query, tz),
  };
}
app.get("/api/admin/dashboard", async (req, res) => {
  const s = await settings(),
    total = await db.submission.count({ where: { mode: req.mode } }),
    today = await db.submission.count({
      where: {
        mode: req.mode,
        submittedAt: { gte: startOfDay(new Date(), s.zona_waktu) },
      },
    }),
    failed = await db.emailLog.count({
      where: { mode: req.mode, status: "gagal" },
    });
  res.json({
    total,
    today,
    failed,
    assumptions,
    mode: await db.mode.findUnique({ where: { id: req.mode } }),
  });
});
app.post("/api/admin/review", async (req, res) => {
  const reviewed = z.boolean().parse(req.body.reviewed);
  await db.mode.update({
    where: { id: req.mode },
    data: { reviewRequired: !reviewed },
  });
  await audit(req, "mode.review", null, { reviewed });
  res.json({ ok: true });
});
app.get("/api/admin/submissions", async (req, res) => {
  const { page, size } = pageParams(req),
    where = await submissionWhere(req),
    sort = ["reference", "vendor", "submittedAt", "status", "bookNumber"].includes(
      req.query.sort,
    )
      ? req.query.sort
      : "submittedAt",
    dir = req.query.dir === "asc" ? "asc" : "desc";
  res.json({
    rows: await db.submission.findMany({
      where,
      select: {
        id: true,
        bookYear: true,
        bookNumber: true,
        reference: true,
        vendor: true,
        email: true,
        submittedAt: true,
        status: true,
      },
      orderBy: [{ bookYear: "desc" }, { [sort]: dir }, { id: "asc" }],
      skip: (page - 1) * size,
      take: size,
    }),
    total: await db.submission.count({ where }),
    page,
    size,
    years: await bookYears(db, "submission", req.mode),
    currentYear: Number(inTimezone(new Date(), (await settings()).zona_waktu).slice(0, 4)),
  });
});
app.get("/api/admin/submissions/export/:format", async (req, res) => {
  const rows = await db.submission.findMany({
    where: await submissionWhere(req),
    orderBy: { submittedAt: "desc" },
  });
  const codes = [...new Set(rows.flatMap((r) => Object.keys(r.values)))];
  await exportSheet(
    req,
    res,
    [
      { code: "reference", label: "No. Referensi" },
      { code: "bookYear", label: "Tahun Buku" },
      { code: "bookNumber", label: "No. Buku" },
      { code: "submittedAt", label: "Waktu selesai" },
      ...codes.map((code) => ({ code, label: code })),
    ],
    rows.map((r) => ({
      ...r.values,
      reference: r.reference,
      bookYear: r.bookYear,
      bookNumber: r.bookNumber,
      submittedAt: r.submittedAt.toISOString(),
    })),
  );
});
app.get("/api/admin/submissions/:id", async (req, res) => {
  const sub = await authorizedSubmission(req);
  const { tokenHash, ...data } = sub;
  res.json({
    ...data,
    form: await db.formVersion.findUnique({ where: { id: sub.formVersionId } }),
  });
});
app.get("/api/admin/submissions/:id/document/:format", download);
app.post(
  "/api/admin/submissions/:id/email",
  limiter("email_limit", 60, 5),
  async (req, res) => {
    const sub = await authorizedSubmission(req);
    res.json(
      await sendMail({ recipient: z.email().parse(req.body.email), sub, req }),
    );
  },
);
app.get("/api/admin/terms", async (req, res) =>
  res.json({
    visibility: await termsVisibility(req.mode),
    term: await db.term.findUnique({ where: { mode: req.mode } }),
    versions: await db.termsVersion.findMany({
      where: { mode: req.mode },
      orderBy: { createdAt: "desc" },
    }),
  }),
);
app.put("/api/admin/terms/visibility", async (req, res) => {
  const enabled = z.boolean().parse(req.body.enabled),
    baseRevision = z.number().int().nonnegative().parse(req.body.baseRevision);
  const visibility = await db.$transaction(async (tx) => {
    const before = await termsVisibility(req.mode, tx);
    if (before.revision !== baseRevision)
      throw fail(
        "Status telah diubah admin lain. Muat ulang menu ketentuan.",
        409,
      );
    if (before.enabled === enabled) return before;
    const after = { enabled, revision: before.revision + 1 };
    await tx.setting.upsert({
      where: { key: visibilityKey(req.mode) },
      create: { key: visibilityKey(req.mode), value: after },
      update: { value: after },
    });
    await audit(req, "terms.visibility", before, after, req.mode, tx);
    return after;
  });
  res.json({ visibility });
});
app.post("/api/admin/terms/preview", (req, res) =>
  res.json({ html: cleanHtml(req.body.html) }),
);
app.put("/api/admin/terms/draft", async (req, res) => {
  const html = cleanHtml(req.body.html);
  const before = await db.term.findUnique({ where: { mode: req.mode } });
  await db.$transaction(async (tx) => {
    await tx.term.update({ where: { mode: req.mode }, data: { draft: html } });
    await audit(req, "terms.draft", before.draft, html, req.mode, tx);
  });
  res.json({ ok: true });
});
app.post("/api/admin/terms/version", async (req, res) => {
  const html = cleanHtml(req.body.html),
    publish = z.boolean().parse(req.body.publish);
  await db.$transaction(async (tx) => {
    const v = await tx.termsVersion.create({
      data: { mode: req.mode, html, author: req.admin.email },
    });
    await tx.term.update({
      where: { mode: req.mode },
      data: { draft: html, ...(publish ? { publishedId: v.id } : {}) },
    });
    await audit(
      req,
      publish ? "terms.publish" : "terms.save",
      null,
      { versionId: v.id },
      req.mode,
      tx,
    );
  });
  res.json({ ok: true });
});
app.post("/api/admin/terms/rollback/:id", async (req, res) => {
  const v = await db.termsVersion.findFirst({
    where: { id: req.params.id, mode: req.mode },
  });
  if (!v) throw fail("Versi tidak ditemukan", 404);
  await db.term.update({ where: { mode: req.mode }, data: { draft: v.html } });
  await audit(req, "terms.rollback", null, { versionId: v.id });
  res.json({ html: v.html });
});
app.get("/api/admin/form", async (req, res) => {
  const f = await db.form.findUnique({ where: { mode: req.mode } });
  res.json({
    version: await db.formVersion.findUnique({ where: { id: f.currentId } }),
    versions: await db.formVersion.findMany({
      where: { mode: req.mode },
      select: { id: true, createdAt: true, note: true },
      orderBy: { createdAt: "desc" },
    }),
    assumptions,
    termsEnabled: (await termsVisibility(req.mode)).enabled,
  });
});
app.get("/api/admin/form/versions/:id", async (req, res) => {
  const v = await db.formVersion.findFirst({
    where: { id: req.params.id, mode: req.mode },
  });
  if (!v) throw fail("Versi tidak ditemukan", 404);
  res.json(v);
});
app.put("/api/admin/form", async (req, res) => {
  const { fields, sections } = req.body;
  try {
    validateDefinition(fields, sections);
  } catch (e) {
    throw fail(e.message);
  }
  for (const f of fields) {
    if (f.validation?.regex) {
      const { default: safeRegex } = await import("safe-regex2");
      if (!safeRegex(f.validation.regex))
        throw fail("Regex berisiko memperlambat server; sederhanakan pola");
    }
    if (JSON.stringify(f).length > 30000)
      throw fail("Definisi field terlalu besar");
  }
  const result = await db.$transaction(
    async (tx) => {
      const current = await tx.form.findUnique({ where: { mode: req.mode } });
      if (current.currentId !== req.body.baseVersionId)
        throw fail("Form sudah diubah admin lain. Muat ulang.", 409);
      const old = await tx.formVersion.findUnique({
        where: { id: current.currentId },
      });
      for (const f of old.fields.filter(
        (f) => !fields.some((n) => n.code === f.code),
      )) {
        if (
          await tx.submissionValue.count({
            where: {
              code: f.code,
              submissionId: {
                in: (
                  await tx.submission.findMany({
                    where: { mode: req.mode },
                    select: { id: true },
                  })
                ).map((s) => s.id),
              },
            },
          })
        )
          throw fail(
            `Field ${f.code} memiliki data historis. Nonaktifkan, jangan hapus.`,
          );
      }
      const v = await tx.formVersion.create({
        data: {
          mode: req.mode,
          fields,
          sections,
          note: String(req.body.note || "Perubahan admin").slice(0, 2000),
        },
      });
      const claimed = await tx.form.updateMany({
        where: { mode: req.mode, currentId: req.body.baseVersionId },
        data: { currentId: v.id },
      });
      if (claimed.count !== 1)
        throw fail("Form sudah diubah admin lain. Muat ulang.", 409);
      await tx.formField.deleteMany({ where: { mode: req.mode } });
      await tx.formField.createMany({
        data: fields.map((f) => ({
          mode: req.mode,
          code: f.code,
          definition: f,
        })),
      });
      await audit(req, "form.update", old.fields, fields, req.mode, tx);
      return v;
    },
    { timeout: 60000 },
  );
  res.json({ version: result });
});
app.get("/api/admin/template", async (req, res) => {
  const d = await db.docTemplate.findUnique({ where: { mode: req.mode } });
  res.json({
    current: await db.templateVersion.findUnique({
      where: { id: d.currentId },
    }),
    versions: await db.templateVersion.findMany({
      where: { mode: req.mode },
      orderBy: { createdAt: "desc" },
    }),
    warning:
      (await db.templateVersion.findUnique({ where: { id: d.currentId } }))
        .author === "seed"
        ? "Template lama belum menggunakan HTML terbaru yang diberikan pengguna."
        : null,
  });
});
app.put("/api/admin/template", async (req, res) => {
  const html = cleanHtml(req.body.html, true);
  renderHtml(html, {}, "CONTOH", await settings(), 2026);
  await db.$transaction(async (tx) => {
    const current = await tx.docTemplate.findUnique({
        where: { mode: req.mode },
      }),
      old = await tx.templateVersion.findUnique({
        where: { id: current.currentId },
      });
    if (req.body.baseVersionId !== current.currentId)
      throw fail("Template sudah berubah. Muat ulang.", 409);
    const v = await tx.templateVersion.create({
      data: { mode: req.mode, html, author: req.admin.email },
    });
    const claimed = await tx.docTemplate.updateMany({
      where: { mode: req.mode, currentId: req.body.baseVersionId },
      data: { currentId: v.id },
    });
    if (claimed.count !== 1)
      throw fail("Template sudah berubah. Muat ulang.", 409);
    await audit(req, "template.update", old.html, html, req.mode, tx);
  });
  res.json({ ok: true });
});
app.post("/api/admin/template/preview/:format", async (req, res) => {
  const s = await settings(),
    year = Number(inTimezone(new Date(), s.zona_waktu).slice(0, 4));
  const values = {
      received_from: "PT Contoh Vendor",
      invoice_number: "INV/001/2026",
      currency: "IDR",
      invoice_date: "2026-10-30",
      amount_nett: 1000000,
      vat: 110000,
      po_number: "PO-BCU-001",
      ...req.body.values,
    };
  const book = z.object({
    nomor_buku: z.number().int().min(1).max(2147483647).optional(),
    tahun_buku: z.number().int().min(1).max(9999).optional(),
  }).parse(req.body.values || {});
  const html = renderHtml(
    req.body.html,
    values,
    "ROI-CONTOH-000001",
    s,
    year,
    {
      bookNumber: book.nomor_buku ?? 1,
      bookYear: book.tahun_buku ?? invoiceYear(values.invoice_date, new Date(), s.zona_waktu),
    },
  );
  res
    .type(req.params.format === "pdf" ? "application/pdf" : "text/html")
    .send(req.params.format === "pdf" ? await pdfBuffer(html) : html);
});
// Separate editable workspace: these routes never update submissions/submission_values.
app.get("/api/admin/custom", async (req, res) =>
  res.json({ ...(await customPage(req.mode, req.query)), history: await customHistoryStatus(db, req) }),
);
app.get("/api/admin/custom/backups", async (req, res) => {
  const { page, size } = pageParams(req),
    where = { status: "selesai" },
    s = await settings();
  res.json({
    mode: req.mode,
    page,
    size,
    rows: await db.backup.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * size,
      take: size,
      select: { id: true, createdAt: true },
    }),
    total: await db.backup.count({ where }),
    schedule: [s.backup_jam || "00:00", s.backup_jam_kedua || "12:00"],
    timeZone: s.zona_waktu,
    retentionDays: s.backup_retensi,
  });
});
app.get("/api/admin/custom/backups/:id", async (req, res) => {
  const snapshot = await customBackupSnapshot(req.params.id, req.mode);
  await audit(
    req,
    "custom.backup.preview",
    null,
    { backupId: snapshot.backupId },
    req.mode,
  );
  res.json(snapshot);
});
app.get("/api/admin/custom/backups/:id/export/:format", async (req, res) => {
  if (!["json", "csv", "xlsx"].includes(req.params.format))
    throw fail("Format tidak didukung");
  const snapshot = await customBackupSnapshot(req.params.id, req.mode);
  const stamp = new Date(snapshot.capturedAt)
    .toISOString()
    .replace(/[:.]/g, "-");
  res.locals.exportFilename = `backup-tabel-kustom-${req.mode}-${stamp}.${req.params.format}`;
  await audit(
    req,
    "custom.backup.download",
    null,
    { backupId: snapshot.backupId, format: req.params.format },
    req.mode,
  );
  if (req.params.format === "json")
    return res
      .attachment(res.locals.exportFilename)
      .type("application/json")
      .send(JSON.stringify(snapshot, null, 2));
  await exportCustom(req, res, snapshot, true);
});
app.post("/api/admin/custom/sync", async (req, res) => {
  if (req.body.confirm !== "SINKRONISASI ULANG")
    throw fail("Ketik SINKRONISASI ULANG untuk konfirmasi");
  const result = await db.$transaction(
    async (tx) => {
      const submissions = await tx.submission.findMany({
        where: { mode: req.mode },
        orderBy: { submittedAt: "asc" },
      });
      const result = await appendMasterRows(tx, req.mode, submissions);
      await audit(req, "custom.sync", null, result, req.mode, tx);
      return result;
    },
    { timeout: 120000 },
  );
  res.json(result);
});
app.post("/api/admin/custom/reset", async (req, res) => {
  if (req.body.confirm !== "RESET SALINAN")
    throw fail("Ketik RESET SALINAN untuk konfirmasi");
  await db.$transaction(async (tx) => {
    const before = await tx.customRow.count({ where: { mode: req.mode } });
    for (const table of [
      "customCell",
      "customRow",
      "customColumn",
      "customView",
    ])
      await tx[table].deleteMany({ where: { mode: req.mode } });
    await tx.setting.deleteMany({ where: { key: schemaKey(req.mode) } });
    await tx.customHistory.deleteMany({ where: { mode: req.mode } });
    await audit(req, "custom.reset", { rows: before }, null, req.mode, tx);
  });
  res.json({ ok: true });
});
registerCustomEditingRoutes(app);
const color = z
  .string()
  .regex(/^#[a-fA-F\d]{6}$/)
  .nullable();
app.get("/api/admin/custom/export/:format", (req, res) => exportCustom(req, res));
function spreadsheetSafe(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "number" || typeof v === "boolean") return v;
  const s = Array.isArray(v) ? v.join("; ") : String(v);
  return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
}
async function exportSheet(req, res, columns, rows, colorFor) {
  if (!["csv", "xlsx"].includes(req.params.format))
    throw fail("Format tidak didukung");
  const book = new ExcelJS.Workbook(),
    sheet = book.addWorksheet("ROI " + req.mode);
  sheet.columns = columns.map((c) => ({
    header: c.label,
    key: c.code,
    width: 24,
    hidden: !!c.hidden,
  }));
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF18784F" },
  };
  rows.forEach((row, i) => {
    const r = sheet.addRow(
      Object.fromEntries(
        columns.map((c) => [c.code, spreadsheetSafe(row[c.code])]),
      ),
    );
    columns.forEach((c, j) => {
      const col = colorFor?.(i, j);
      if (col)
        r.getCell(j + 1).fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FF" + col.slice(1).toUpperCase() },
        };
    });
  });
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  const csv = req.params.format === "csv",
    bytes = csv
      ? Buffer.concat([
          Buffer.from("\uFEFF"),
          Buffer.from(await book.csv.writeBuffer()),
        ])
      : await book.xlsx.writeBuffer();
  await audit(req, "export." + req.params.format, null, { rows: rows.length });
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${res.locals.exportFilename || `roi-${req.mode}.${req.params.format}`}"`,
  );
  res
    .type(
      csv
        ? "text/csv"
        : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )
    .send(Buffer.from(bytes));
}
app.get("/api/admin/logs/:kind", async (req, res) => {
  const email = req.params.kind === "email",
    table = email ? "emailLog" : "activityLog",
    where = {
      ...(email
        ? { mode: req.mode }
        : { OR: [{ mode: req.mode }, { mode: null }] }),
      createdAt: dateFilter(req.query, (await settings()).zona_waktu),
    };
  if (req.query.q) {
    const q = String(req.query.q);
    where.AND = [
      {
        OR: (email
          ? ["recipient", "status", "error"]
          : ["actor", "action", "ip"]
        ).map((k) => ({ [k]: textSearch(q) })),
      },
    ];
  }
  const { page, size } = pageParams(req);
  if (req.query.export) {
    req.params.format = z.enum(["csv", "xlsx"]).parse(req.query.export);
    const rows = await db[table].findMany({
      where,
      orderBy: { createdAt: "desc" },
    });
    return exportSheet(
      req,
      res,
      (email
        ? ["createdAt", "recipient", "status", "error"]
        : ["createdAt", "actor", "action", "ip", "before", "after"]
      ).map((code) => ({ code, label: code })),
      rows.map((r) => ({
        ...r,
        createdAt: r.createdAt.toISOString(),
        before: JSON.stringify(r.before),
        after: JSON.stringify(r.after),
      })),
    );
  }
  res.json({
    rows: await db[table].findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * size,
      take: size,
    }),
    total: await db[table].count({ where }),
    page,
    size,
  });
});
app.get("/api/admin/backups", superadmin, async (req, res) =>
  res.json(await db.backup.findMany({ orderBy: { createdAt: "desc" } })),
);
app.post("/api/admin/backups", superadmin, async (req, res) =>
  res.json(await createBackup(req)),
);
app.get("/api/admin/backups/:id/download", superadmin, async (req, res) => {
  const b = await db.backup.findUnique({ where: { id: req.params.id } });
  if (!b || b.status !== "selesai") throw fail("Backup tidak tersedia", 404);
  await audit(req, "backup.download", null, { id: b.id }, null);
  res.download(archivePath(b.filename), path.basename(b.filename));
});
const restoreTickets = new Map();
app.post("/api/admin/backups/:id/prepare-restore", superadmin, (req, res) => {
  const token = random();
  restoreTickets.set(token, {
    id: req.params.id,
    session: req.session.id,
    expires: Date.now() + 120000,
  });
  res.json({
    token,
    phrase: "PULIHKAN " + req.params.id,
    message:
      "Langkah 2: ketik frasa ini. Backup pengaman dibuat otomatis; semua session akan diakhiri.",
  });
});
app.post("/api/admin/backups/:id/restore", superadmin, async (req, res) => {
  const t = restoreTickets.get(req.body.token);
  restoreTickets.delete(req.body.token);
  if (
    !t ||
    t.id !== req.params.id ||
    t.session !== req.session.id ||
    t.expires < Date.now() ||
    req.body.confirm !== "PULIHKAN " + t.id
  )
    throw fail("Konfirmasi restore tidak valid/kedaluwarsa");
  res.json(await restoreBackup(t.id, req));
});
app.get("/api/admin/settings", superadmin, async (req, res) => {
  const s = await settings();
  res.json({
    ...safeMailSettings(s),
    email_transport: s.email_transport || "smtp",
    smtp_password: undefined,
    smtp_password_set: !!s.smtp_password,
  });
});
app.get("/api/admin/mail/status", superadmin, async (req, res) =>
  res.json({ providers: await mailConnectionStatus() }),
);
app.post(
  "/api/admin/mail/oauth/:provider/start",
  superadmin,
  limiter("login_limit", 15, 5),
  async (req, res) =>
    res.json(
      await beginMailConnection(
        req,
        res,
        z.enum(["outlook", "gmail"]).parse(req.params.provider),
      ),
    ),
);
app.delete("/api/admin/mail/oauth/:provider", superadmin, async (req, res) => {
  await disconnectMail(
    z.enum(["outlook", "gmail"]).parse(req.params.provider),
    req,
  );
  res.json({ ok: true });
});
const settingsSchema = z
  .object({
    nama_aplikasi: z.string().min(1).max(150),
    nama_perusahaan: z.string().min(1).max(200),
    kop: z.string().max(1000),
    logo: z.string().regex(/^(|\/uploads\/[a-zA-Z0-9-]+\.(png|jpg|webp))$/),
    zona_waktu: z.string(),
    format_nomor: z.string().min(10).max(80),
    penerima_nama: z.string().max(200),
    kode_form: z.string().max(80),
    email_pengirim: z.email(),
    email_transport: z.enum(["smtp", "outlook", "gmail", "none"]),
    email_subjek: z.string().min(1).max(200),
    email_isi: z.string().max(10000),
    smtp_host: z.string().max(250),
    smtp_port: z.number().int().min(1).max(65535),
    smtp_user: z.string().max(250),
    smtp_password: z.string().max(500).optional(),
    smtp_secure: z.boolean(),
    password_min: z.number().int().min(12).max(64),
    session_hours: z.number().min(1).max(72),
    login_limit: z.number().int().min(3).max(30),
    public_limit: z.number().int().min(5).max(300),
    email_limit: z.number().int().min(1).max(30),
    backup_jam: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    backup_jam_kedua: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    backup_retensi: z.number().int().min(1).max(365),
    backup_lokasi: z.string().min(1).max(150),
    tema_internal: color,
    tema_eksternal: color,
    aksen_internal: color,
    aksen_eksternal: color,
    upload_mb: z.number().min(1).max(20),
    upload_types: z
      .array(
        z.enum(["image/png", "image/jpeg", "image/webp", "application/pdf"]),
      )
      .min(1),
  })
  .partial();
app.put("/api/admin/settings", superadmin, async (req, res) => {
  const b = settingsSchema.parse(req.body);
  const existing = await settings(),
    method = b.email_transport || existing.email_transport || "smtp";
  if (["gmail", "outlook"].includes(method)) {
    const connection = (await mailConnectionStatus())[method];
    if (!connection.connected || connection.needsReconnect)
      throw fail(
        "Hubungkan kembali akun email yang dipilih sebelum menyimpan.",
        422,
      );
    if (
      b.email_pengirim &&
      b.email_pengirim.toLowerCase() !== connection.email.toLowerCase()
    )
      throw fail("Pengirim harus sama dengan akun email yang terhubung.", 422);
    b.email_pengirim = connection.email;
  }
  if (b.zona_waktu)
    try {
      inTimezone(new Date(), b.zona_waktu);
    } catch {
      throw fail("Zona waktu tidak valid");
    }
  if (
    b.format_nomor &&
    (!b.format_nomor.includes("{MODE}") ||
      !b.format_nomor.includes("{YEAR}") ||
      !/\{SEQ:[1-9]\}/.test(b.format_nomor) ||
      /[^A-Z0-9{}_:\-]/.test(b.format_nomor) ||
      /\{(?!MODE\}|YEAR\}|SEQ:[1-9]\})/.test(b.format_nomor))
  )
    throw fail(
      "Nomor wajib memuat {MODE}, {YEAR}, {SEQ:6}; hanya huruf kapital, angka dan tanda hubung",
    );
  if (b.backup_lokasi) {
    const { dataDir } = await import("./core.js");
    const p = path.resolve(dataDir, b.backup_lokasi);
    if (
      !p.startsWith(dataDir + path.sep) ||
      p === uploadDir ||
      p.startsWith(uploadDir + path.sep)
    )
      throw fail("Lokasi backup harus subfolder DATA_DIR di luar uploads");
  }
  const before = await settings();
  await db.$transaction(async (tx) => {
    for (const [key, value] of Object.entries(b)) {
      if (key === "smtp_password" && !value) continue;
      await tx.setting.upsert({
        where: { key },
        create: {
          key,
          value:
            key === "smtp_password" ? encrypt(value).toString("base64") : value,
        },
        update: {
          value:
            key === "smtp_password" ? encrypt(value).toString("base64") : value,
        },
      });
    }
    const redact = (s) => ({
      ...safeMailSettings(s),
      smtp_password: s.smtp_password ? "[terenkripsi]" : undefined,
    });
    await audit(req, "settings.update", redact(before), redact(b), null, tx);
  });
  res.json({ ok: true });
});
app.post(
  "/api/admin/settings/test-email",
  superadmin,
  limiter("email_limit", 60, 5),
  async (req, res) =>
    res.json(
      await sendMail({ recipient: z.email().parse(req.body.email), req }),
    ),
);
app.get("/api/admin/admins", superadmin, async (req, res) =>
  res.json(
    await db.admin.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        active: true,
        createdAt: true,
      },
    }),
  ),
);
const adminSchema = z.object({
  name: z.string().min(1).max(150),
  email: z.email(),
  role: z.enum(["admin", "superadmin"]),
  active: z.boolean(),
  password: z
    .string()
    .max(72)
    .refine(
      (value) => Buffer.byteLength(value, "utf8") <= 72,
      "Password maksimal 72 byte UTF-8",
    )
    .optional(),
});
app.post("/api/admin/admins", superadmin, async (req, res) => {
  const b = adminSchema.parse(req.body),
    s = await settings();
  if (
    !b.password ||
    b.password.length < Number(s.password_min) ||
    !/[a-z]/.test(b.password) ||
    !/[A-Z]/.test(b.password) ||
    !/\d/.test(b.password)
  )
    throw fail(
      `Password minimal ${s.password_min} karakter, huruf besar, kecil, dan angka`,
    );
  const a = await db.admin.create({
    data: {
      ...b,
      email: b.email.toLowerCase(),
      password: await bcrypt.hash(b.password, 12),
    },
  });
  await audit(
    req,
    "admin.create",
    null,
    { id: a.id, email: a.email, role: a.role },
    null,
  );
  res.json({ id: a.id });
});
app.put("/api/admin/admins/:id", superadmin, async (req, res) => {
  const b = adminSchema.parse(req.body),
    s = await settings(),
    old = await db.admin.findUnique({ where: { id: req.params.id } });
  if (!old) throw fail("Admin tidak ditemukan", 404);
  if (old.id === req.admin.id && (!b.active || b.role !== "superadmin"))
    throw fail("Anda tidak dapat menonaktifkan/menurunkan role akun sendiri");
  if (
    b.password &&
    (b.password.length < Number(s.password_min) ||
      !/[a-z]/.test(b.password) ||
      !/[A-Z]/.test(b.password) ||
      !/\d/.test(b.password))
  )
    throw fail("Password belum memenuhi kebijakan");
  await db.$transaction(async (tx) => {
    await tx.admin.update({
      where: { id: old.id },
      data: {
        ...b,
        email: b.email.toLowerCase(),
        password: b.password ? await bcrypt.hash(b.password, 12) : undefined,
      },
    });
    await tx.session.deleteMany({ where: { adminId: old.id } });
    await audit(
      req,
      "admin.update",
      { id: old.id, email: old.email, role: old.role, active: old.active },
      {
        id: old.id,
        email: b.email,
        role: b.role,
        active: b.active,
        passwordChanged: !!b.password,
      },
      null,
      tx,
    );
  });
  res.json({ ok: true });
});
app.get("/vendor/roi-id.js", (req, res) =>
  res
    .type("application/javascript")
    .sendFile(path.resolve("node_modules/tinymce-i18n/langs8/id.js")),
);
app.use(
  "/vendor/tinymce",
  express.static(path.resolve("node_modules/tinymce"), { maxAge: "1d" }),
);
app.use(express.static(path.resolve("dist")));
app.get(/^(?!\/api\/|\/uploads\/|\/vendor\/).*/, (req, res) =>
  res.sendFile(path.resolve("dist/index.html")),
);
app.use("/api", (req, res) =>
  res.status(404).json({ error: "Endpoint tidak ditemukan" }),
);
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const validation = err instanceof z.ZodError;
  const status =
    err.status ||
    (validation
      ? 422
      : err.code === "P2002"
        ? 409
        : err.code === "LIMIT_FILE_SIZE"
          ? 413
          : 500);
  if (status === 500) console.error(err);
  res.status(status).json({
    error: validation
      ? "Data tidak valid: " +
        err.issues.map((i) => i.path.join(".") + " " + i.message).join("; ")
      : status === 500
        ? "Terjadi kesalahan pada server"
        : err.code === "P2002"
          ? "Nilai unik sudah digunakan. Periksa data kembali."
          : err.message,
    details: err.details,
  });
});
