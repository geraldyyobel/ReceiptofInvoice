import { z } from "zod";
import { rateLimit } from "express-rate-limit";
import { db, fail, audit } from "./core.js";

export function registerNotifications(app) {
  const visible = (req, now = new Date()) => ({ adminId: req.admin.id,
    notification: { mode: req.mode, canceledAt: null, dueAt: { lte: now } } });
  app.get("/api/admin/notifications/recipients", async (req, res) => {
    res.json(await db.admin.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }));
  });
  app.get("/api/admin/notifications/unread", async (req, res) => {
    res.json({ unread: await db.adminNotificationRecipient.count({ where: { ...visible(req), readAt: null } }) });
  });
  app.get("/api/admin/notifications", async (req, res) => {
    const pageRequested = Math.max(1, Math.min(100000, Math.floor(Number(req.query.page) || 1)));
    const sent = req.query.box === "sent", unread = req.query.unread === "1", size = 20;
    const where = sent ? { mode: req.mode, authorId: req.admin.id }
      : { ...visible(req), ...(unread ? { readAt: null } : {}) };
    const model = sent ? db.adminNotification : db.adminNotificationRecipient;
    const total = await model.count({ where }), page = Math.min(pageRequested, Math.max(1, Math.ceil(total / size)));
    const rows = await model.findMany({ where, skip: (page - 1) * size, take: size,
      orderBy: sent ? [{ createdAt: "desc" }, { id: "desc" }] : [{ notification: { dueAt: "desc" } }, { id: "desc" }],
      include: sent ? { recipients: { select: { adminId: true, readAt: true } } } : { notification: true },
    });
    res.json({ rows, page, size, total, box: sent ? "sent" : "inbox" });
  });
  app.post("/api/admin/notifications", rateLimit({ windowMs: 60000, limit: 20, legacyHeaders: false, keyGenerator: (req) => req.admin.id,
    message: { error: "Terlalu banyak notifikasi. Coba lagi satu menit." } }), async (req, res) => {
    const b = z.object({ title: z.string().trim().min(1).max(160), message: z.string().trim().min(1).max(5000),
      kind: z.enum(["info", "reminder"]), priority: z.enum(["normal", "urgent"]).default("normal"),
      all: z.boolean().default(false), recipients: z.array(z.string().min(1)).max(200).default([]),
      dueAt: z.iso.datetime().optional(),
    }).parse(req.body);
    const dueAt = b.dueAt ? new Date(b.dueAt) : new Date();
    if (+dueAt < Date.now() - 60000 || +dueAt > Date.now() + 366 * 86400000)
      throw fail("Waktu pengingat harus sekarang hingga satu tahun ke depan", 422);
    const result = await db.$transaction(async (tx) => {
      const unique = [...new Set(b.recipients)];
      const recipients = await tx.admin.findMany({ where: { active: true, ...(b.all ? {} : { id: { in: unique } }) }, select: { id: true } });
      if (!recipients.length || (!b.all && recipients.length !== unique.length)) throw fail("Pilih penerima admin aktif yang valid", 422);
      const n = await tx.adminNotification.create({ data: { mode: req.mode, authorId: req.admin.id, authorName: req.admin.name,
        title: b.title, message: b.message, kind: b.kind, priority: b.priority, dueAt,
        recipients: { create: recipients.map((a) => ({ adminId: a.id })) },
      } });
      await audit(req, "notification.create", null, { id: n.id, title: n.title, dueAt, recipients: recipients.map((a) => a.id) }, req.mode, tx);
      return n;
    });
    res.status(201).json(result);
  });
  app.post("/api/admin/notifications/read-all", async (req, res) => {
    const result = await db.$transaction(async (tx) => {
      const result = await tx.adminNotificationRecipient.updateMany({ where: { ...visible(req), readAt: null }, data: { readAt: new Date() } });
      await audit(req, "notification.read_all", null, { count: result.count }, req.mode, tx); return result;
    });
    res.json(result);
  });
  app.post("/api/admin/notifications/:id/read", async (req, res) => {
    await db.$transaction(async (tx) => {
      const where = { ...visible(req), notificationId: req.params.id };
      if (!await tx.adminNotificationRecipient.findFirst({ where })) throw fail("Notifikasi tidak ditemukan", 404);
      const result = await tx.adminNotificationRecipient.updateMany({ where: { ...where, readAt: null }, data: { readAt: new Date() } });
      if (result.count) await audit(req, "notification.read", null, { id: req.params.id }, req.mode, tx);
    });
    res.json({ ok: true });
  });
  app.post("/api/admin/notifications/:id/cancel", async (req, res) => {
    await db.$transaction(async (tx) => {
      const where = { id: req.params.id, mode: req.mode, ...(req.admin.role === "superadmin" ? {} : { authorId: req.admin.id }) };
      if (!await tx.adminNotification.findFirst({ where })) throw fail("Notifikasi tidak ditemukan atau bukan milik Anda", 404);
      const result = await tx.adminNotification.updateMany({ where: { ...where, canceledAt: null }, data: { canceledAt: new Date() } });
      if (result.count) await audit(req, "notification.cancel", null, { id: req.params.id }, req.mode, tx);
    });
    res.json({ ok: true });
  });
}
