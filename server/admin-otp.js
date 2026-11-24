import { randomInt } from "node:crypto";
import bcrypt from "bcryptjs";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { adminEmailDomain, isBcuAdminEmail, normalizeAdminEmail } from "../shared/admin-email.js";
import { masterReaderRole } from "../shared/admin-routing.js";
import { audit, db, equal, fail, hash, random, settings } from "./core.js";
import { smtpConfigured, smtpTransport } from "./smtp.js";

export const bcuAdminEmail = z.string().trim().max(254).pipe(z.email())
  .refine(isBcuAdminEmail, `Gunakan email BCU @${adminEmailDomain}`)
  .transform(normalizeAdminEmail);

const codeLifetime = 5 * 60000;
const resendSeconds = 60;
const maxGuesses = 5;
// The app runs as a single process. Restart and restore invalidate pending codes.
const pending = new Map();
const requestSchema = z.object({ email: bcuAdminEmail });
const verifySchema = requestSchema.extend({
  challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  code: z.string().regex(/^\d{6}$/, "Masukkan enam angka kode OTP"),
});
const accountProof = (admin) => hash(JSON.stringify([
  "admin-otp-account", admin.id, admin.email, admin.role, admin.password,
]));
const ticketProof = (challenge, csrf) => hash(`admin-otp-ticket:${challenge}:${csrf}`);
const codeProof = (challenge, code) => hash(`admin-otp-code:${challenge}:${code}`);

export function clearAdminOtp(email) {
  if (email === undefined) pending.clear();
  else pending.delete(normalizeAdminEmail(email));
}

export function registerAdminOtp(app, limiter, finishLogin) {
  const emailLimiter = rateLimit({
    windowMs: resendSeconds * 1000,
    limit: 1,
    keyGenerator: (req) => hash(req.otpEmail),
    message: { error: "Tunggu satu menit sebelum meminta kode OTP lagi." },
  });
  app.post(
    "/api/auth/otp/request",
    limiter("login_limit", 15, 5),
    (req, res, next) => {
      req.otpEmail = requestSchema.parse(req.body).email;
      next();
    },
    emailLimiter,
    async (req, res) => {
      const email = req.otpEmail;
      const config = await settings();
      if (!smtpConfigured(config))
        throw fail("Login OTP belum tersedia. Gunakan password atau hubungi Super Admin.", 503);
      const admin = await db.admin.findUnique({ where: { email } });
      const challenge = random();
      const now = Date.now();
      for (const [address, item] of pending)
        if (item.expiresAt <= now) pending.delete(address);

      if (!admin || admin.active) {
        const code = String(randomInt(1000000)).padStart(6, "0");
        const item = {
          ticket: ticketProof(challenge, req.signedCookies.roi_csrf),
          code: codeProof(challenge, code),
          account: admin ? accountProof(admin) : null,
          expiresAt: now + codeLifetime,
          guesses: 0,
          ready: false,
        };
        pending.set(email, item);
        let delivered = false;
        try {
          const result = await smtpTransport(config).sendMail({
            from: config.email_pengirim,
            to: email,
            subject: "Kode OTP login ROI BCU",
            text: `Kode OTP untuk masuk ke ROI BCU: ${code}\n\nKode berlaku 5 menit dan hanya dapat dipakai sekali. Jika Anda tidak meminta kode ini, abaikan email ini.`,
          });
          delivered = !result?.rejected?.length;
        } catch {
          // Keep SMTP diagnostics and the OTP out of the public response and audit data.
        }
        if (pending.get(email) === item) {
          if (delivered) item.ready = true;
          else pending.delete(email);
        }
        await audit(req, delivered ? "auth.otp_sent" : "auth.otp_send_failed", null, { email }, null);
      }
      // The response never indicates whether the account exists.
      res.status(202).json({ challenge, resendAfter: resendSeconds });
    },
  );

  app.post("/api/auth/otp/verify", limiter("login_limit", 15, 5), async (req, res) => {
    const { email, challenge, code } = verifySchema.parse(req.body);
    const item = pending.get(email);
    const invalid = () => fail("Kode OTP tidak valid atau sudah kedaluwarsa.", 401);
    if (!item?.ready || item.expiresAt <= Date.now() ||
      !equal(item.ticket, ticketProof(challenge, req.signedCookies.roi_csrf)))
      throw invalid();
    if (!equal(item.code, codeProof(challenge, code))) {
      if (++item.guesses >= maxGuesses) pending.delete(email);
      await audit(req, "auth.login_failed", null, { email, method: "otp" }, null);
      throw invalid();
    }
    // Consume before awaiting I/O so simultaneous requests cannot reuse the same code.
    pending.delete(email);
    if (item.account !== null) {
      const admin = await db.admin.findUnique({ where: { email } });
      if (!admin?.active || !equal(item.account, accountProof(admin))) throw invalid();
      return finishLogin(req, res, admin, "otp");
    }

    // A registration challenge is never authorization for an account created in the meantime.
    const password = await bcrypt.hash(random(), 12);
    let created;
    try {
      created = await db.$transaction(async (tx) => {
        const user = await tx.admin.create({
          data: { email, name: email.split("@")[0].slice(0, 150), role: masterReaderRole, password },
        });
        await audit(req, "admin.create_from_otp", null, { id: user.id, email, role: user.role }, null, tx);
        return user;
      });
    } catch (error) {
      if (error.code === "P2002") throw invalid();
      throw error;
    }
    await finishLogin(req, res, created, "otp");
  });
}
