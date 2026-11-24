import { removeDeprecatedMailSettings } from "./mail-settings.js";
import { clearAdminOtp } from "./admin-otp.js";
import { isBcuAdminEmail } from "../shared/admin-email.js";
import path from "node:path";
import {
  mkdir,
  readFile,
  writeFile,
  rename,
  rm,
  readdir,
} from "node:fs/promises";
import AdmZip from "adm-zip";
import { backfillBooks } from "./bookkeeping.js";
import { swapUploadFolders } from "./upload-swap.js";
import {
  db,
  dataDir,
  uploadDir,
  settings,
  encrypt,
  decrypt,
  audit,
  fail,
  inTimezone,
} from "./core.js";
// Logical, transactional dumps work identically on all three supported providers.
const tables = [
  "admin",
  "mode",
  "term",
  "termsVersion",
  "form",
  "formVersion",
  "formField",
  "submission",
  "submissionValue",
  "counter",
  "customColumn",
  "customRow",
  "customCell",
  "customView",
  "docTemplate",
  "templateVersion",
  "upload",
  "activityLog",
  "emailLog",
  "setting",
  "adminNotification",
  "adminNotificationRecipient",
];
const dates = {
  adminNotification: ["dueAt", "createdAt", "canceledAt"],
  adminNotificationRecipient: ["readAt"],
  admin: ["createdAt"],
  termsVersion: ["createdAt"],
  formVersion: ["createdAt"],
  submission: ["startedAt", "submittedAt"],
  customRow: ["createdAt"],
  templateVersion: ["createdAt"],
  upload: ["createdAt"],
  activityLog: ["createdAt"],
  emailLog: ["createdAt"],
};
export const maintenance = { busy: false, active: 0 };
async function drain(req) {
  const deadline = Date.now() + 45000;
  while (maintenance.active > (req?.tracked ? 1 : 0)) {
    if (Date.now() > deadline)
      throw fail(
        "Permintaan lain masih berjalan. Ulangi backup setelah selesai.",
        503,
      );
    await new Promise((r) => setTimeout(r, 50));
  }
}
export function archivePath(filename) {
  const p = path.resolve(dataDir, filename);
  if (
    !p.startsWith(dataDir + path.sep) ||
    p === uploadDir ||
    p.startsWith(uploadDir + path.sep)
  )
    throw fail("Lokasi arsip tidak valid");
  return p;
}
export async function backupPath() {
  const s = await settings();
  const dest = path.resolve(dataDir, String(s.backup_lokasi || "backups"));
  if (
    !dest.startsWith(dataDir + path.sep) ||
    dest === uploadDir ||
    dest.startsWith(uploadDir + path.sep)
  )
    throw fail("Lokasi backup harus subfolder DATA_DIR di luar uploads");
  await mkdir(dest, { recursive: true });
  return dest;
}
async function createUnlocked(req) {
  const cfg = await settings();
  const name = `backup_${inTimezone(new Date(), cfg.zona_waktu).replace(" ", "_").replace(":", "")}_${Date.now()}.zip.enc`,
    dir = await backupPath();
  try {
    const snapshot = await db.$transaction(
      async (tx) => {
        const rows = {};
        for (const table of tables) rows[table] = await tx[table].findMany();
        return rows;
      },
      { timeout: 120000 },
    );
    const zip = new AdmZip();
    zip.addFile(
      "database.json",
      Buffer.from(
        JSON.stringify({
          version: 1,
          createdAt: new Date(),
          scheduledSlot: req?.scheduledSlot || null,
          tables: snapshot,
        }),
      ),
    );
    for (const u of snapshot.upload)
      zip.addFile(
        "uploads/" + u.filename,
        await readFile(path.join(uploadDir, u.filename)),
      );
    const data = encrypt(zip.toBuffer());
    await writeFile(path.join(dir, name), data, { flag: "wx" });
    const b = await db.$transaction(async (tx) => {
      const record = await tx.backup.create({
        data: {
          filename: path
            .relative(dataDir, path.join(dir, name))
            .split(path.sep)
            .join("/"),
          size: data.length,
          status: "selesai",
        },
      });
      if (req?.scheduledSlot)
        await tx.setting.upsert({
          where: { key: "backup_last_slot" },
          create: { key: "backup_last_slot", value: req.scheduledSlot },
          update: { value: req.scheduledSlot },
        });
      await audit(
        req,
        "backup.create",
        null,
        {
          id: record.id,
          ...(req?.scheduledSlot ? { scheduledSlot: req.scheduledSlot } : {}),
        },
        null,
        tx,
      );
      return record;
    });
    return b;
  } catch (e) {
    await db.backup.create({
      data: { filename: name, size: 0, status: "gagal", error: e.message },
    });
    throw e;
  }
}
export async function createBackup(req) {
  if (maintenance.busy) throw fail("Backup/restore sedang berjalan", 503);
  maintenance.busy = true;
  try {
    await drain(req);
    return await createUnlocked(req);
  } finally {
    maintenance.busy = false;
  }
}
export async function restoreBackup(id, req) {
  if (maintenance.busy) throw fail("Backup/restore sedang berjalan", 503);
  maintenance.busy = true;
  const staging = path.join(dataDir, "restore-" + Date.now()),
    old = path.join(dataDir, "uploads-before-" + Date.now());
  try {
    await drain(req);
    const b = await db.backup.findUnique({ where: { id } });
    if (!b || b.status !== "selesai") throw fail("Backup tidak tersedia", 404);
    const zip = new AdmZip(decrypt(await readFile(archivePath(b.filename))));
    const manifest = JSON.parse(zip.readAsText("database.json"));
    if (manifest.tables) for (const table of ["adminNotification", "adminNotificationRecipient"])
      if (manifest.tables[table] === undefined) manifest.tables[table] = [];
    if (
      manifest.version !== 1 ||
      tables.some((t) => !Array.isArray(manifest.tables?.[t]))
    )
      throw fail("Format backup tidak valid");
    if (!manifest.tables.admin.some((admin) =>
      admin?.active && admin.role === "superadmin" && isBcuAdminEmail(admin.email),
    )) throw fail("Backup harus memuat Super Admin BCU aktif agar akses admin tetap tersedia.", 422);
    // Validate every entry and unpack only names in the signed/encrypted database manifest.
    await mkdir(staging, { recursive: true });
    for (const u of manifest.tables.upload) {
      if (!/^[a-zA-Z0-9-]+\.(png|jpg|webp|pdf)$/.test(u.filename))
        throw fail("Nama upload backup tidak valid");
      const bytes = zip.readFile("uploads/" + u.filename);
      if (!bytes) throw fail("Upload backup tidak lengkap");
      await writeFile(path.join(staging, u.filename), bytes);
    }
    const safety = await createUnlocked(req);
    await swapUploadFolders(staging, uploadDir, old);
    try {
      await db.$transaction(
        async (tx) => {
          await tx.session.deleteMany();
          // Undo stacks belong to the live workspace, and must never be replayed after a restore.
          await tx.customHistory.deleteMany();
          for (const table of [...tables].reverse())
            await tx[table].deleteMany();
          for (const table of tables) {
            const { Prisma } = await import("@prisma/client");
            for (const row of manifest.tables[table]) {
              for (const field of dates[table] || [])
                if (row[field]) row[field] = new Date(row[field]);
              if (table === "activityLog") {
                if (row.before === null) row.before = Prisma.DbNull;
                if (row.after === null) row.after = Prisma.DbNull;
              }
            }
            for (let i = 0; i < manifest.tables[table].length; i += 200)
              await tx[table].createMany({
                data: manifest.tables[table].slice(i, i + 200),
              });
          }
          await removeDeprecatedMailSettings(tx, req);
          await backfillBooks(tx);
          await audit(
            req,
            "backup.restore",
            null,
            { id, safetyId: safety.id },
            null,
            tx,
          );
        },
        { timeout: 120000 },
      );
    } catch (e) {
      await rm(uploadDir, { recursive: true, force: true });
      await rename(old, uploadDir);
      throw e;
    }
    clearAdminOtp();
    await rm(old, { recursive: true, force: true });
    return {
      message:
        "Restore selesai. Seluruh session diakhiri; silakan login kembali.",
      safetyId: safety.id,
    };
  } catch (e) {
    await audit(
      req,
      "backup.restore_failed",
      null,
      { id, error: String(e.message).slice(0, 1000) },
      null,
    );
    throw e;
  } finally {
    await rm(staging, { recursive: true, force: true });
    maintenance.busy = false;
  }
}
export async function retention() {
  const s = await settings(),
    cutoff = new Date(Date.now() - Number(s.backup_retensi) * 86400000);
  for (const b of await db.backup.findMany({
    where: { createdAt: { lt: cutoff } },
  })) {
    await rm(archivePath(b.filename), { force: true });
    await db.backup.delete({ where: { id: b.id } });
  }
}
