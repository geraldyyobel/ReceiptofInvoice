import { readFile } from "node:fs/promises";
import AdmZip from "adm-zip";
import { db, decrypt, fail } from "./core.js";
import { archivePath } from "./backup.js";
import { withReviewDefaults } from "./custom-review.js";

// Read only the selected mode's editable workspace. Never return the full
// archive: it contains credentials, master data, and the other mode as well.
export async function customBackupSnapshot(id, mode) {
  const backup = await db.backup.findUnique({ where: { id } });
  if (!backup || backup.status !== "selesai")
    throw fail("Backup tidak tersedia", 404);
  let manifest;
  try {
    const bytes = await readFile(archivePath(backup.filename));
    const zip = new AdmZip(decrypt(bytes));
    manifest = JSON.parse(zip.readAsText("database.json"));
  } catch (e) {
    if (e.code === "ENOENT")
      throw fail("Berkas backup sudah tidak tersedia", 404);
    throw fail("Arsip backup tidak dapat dibaca. Hubungi Super Admin.", 500);
  }
  if (
    manifest.version !== 1 ||
    ["customColumn", "customRow", "customCell", "customView"].some(
      (t) => !Array.isArray(manifest.tables?.[t]),
    )
  )
    throw fail("Arsip tidak memuat backup tabel kustom yang valid", 422);
  const columns = manifest.tables.customColumn
    .filter((c) => c.mode === mode)
    .sort((a, b) => a.position - b.position);
  const rows = manifest.tables.customRow
    .filter((r) => r.mode === mode)
    .map(withReviewDefaults)
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  const rowIds = new Set(rows.map((r) => r.id)),
    colIds = new Set(columns.map((c) => c.id));
  return {
    version: 1,
    backupId: backup.id,
    mode,
    capturedAt: manifest.createdAt || backup.createdAt.toISOString(),
    scheduledSlot: manifest.scheduledSlot || null,
    columns,
    rows,
    cells: manifest.tables.customCell.filter(
      (c) => c.mode === mode && rowIds.has(c.rowId) && colIds.has(c.columnId),
    ),
    views: manifest.tables.customView.filter((v) => v.mode === mode),
  };
}
