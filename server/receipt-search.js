import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { db, equal, hash } from "./core.js";
import { sendMail } from "./documents.js";

const criteria = z.discriminatedUnion("by", [
  z.object({
    by: z.literal("reference"),
    reference: z.string().trim().min(1).max(100).toUpperCase(),
  }),
  z.object({
    by: z.literal("book"),
    mode: z.enum(["internal", "eksternal"]),
    bookYear: z.number().int().min(1).max(9999),
    bookNumber: z.number().int().min(1).max(2147483647),
  }),
]);
const lookup = z.object({
  criteria,
  proofs: z.array(z.object({
    id: z.string().min(1).max(64),
    token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  })).max(3).default([]),
});
const recovery = z.object({
  criteria,
  email: z.string().trim().max(254).pipe(z.email()),
});
const metadata = {
  id: true,
  reference: true,
  mode: true,
  bookYear: true,
  bookNumber: true,
};
const normalizeEmail = (email) => email.trim().toLowerCase();

function receiptKey(query) {
  if (query.by === "reference") return { reference: query.reference };
  const { mode, bookYear, bookNumber } = query;
  return { mode_bookYear_bookNumber: { mode, bookYear, bookNumber } };
}

export function registerReceiptSearch(app, limiter) {
  app.post("/api/public/receipts/lookup", limiter("public_limit", 15, 30), async (req, res) => {
    const query = lookup.parse(req.body);
    const found = await db.submission.findUnique({
      where: receiptKey(query.criteria),
      select: { ...metadata, tokenHash: true },
    });
    if (!found) return res.json({ found: false, receipt: null });
    if (!query.proofs.some(({ id, token }) =>
      id === found.id && equal(found.tokenHash, hash(token)),
    )) return res.json({ found: true, receipt: null });

    const { tokenHash, ...receipt } = found;
    res.json({ found: true, receipt });
  });

  app.post(
    "/api/public/receipts/email",
    limiter("email_limit", 60, 5),
    (req, res, next) => {
      req.receiptRecovery = recovery.parse(req.body);
      next();
    },
    rateLimit({
      windowMs: 15 * 60000,
      limit: 5,
      keyGenerator: (req) => hash(normalizeEmail(req.receiptRecovery.email)),
      message: { error: "Terlalu banyak permintaan email. Coba lagi beberapa saat." },
    }),
    async (req, res) => {
      const query = req.receiptRecovery;
      const sub = await db.submission.findUnique({ where: receiptKey(query.criteria) });
      const recipient = sub?.email.trim();
      if (recipient && normalizeEmail(recipient) === normalizeEmail(query.email)) {
        try {
          await sendMail({ recipient, sub, req });
        } catch (error) {
          // Keep the same public response for missing receipts and SMTP failures.
          if (error.status !== 502) throw error;
        }
      }
      res.status(202).json({ ok: true });
    },
  );
}
