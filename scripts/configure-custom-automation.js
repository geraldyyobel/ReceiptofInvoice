import { db, audit } from "../server/core.js";
import { appendMasterRows } from "../server/custom-sync.js";
import { createBackup } from "../server/backup.js";
import assert from "node:assert/strict";
try {
  const safety = await createBackup({
    admin: { email: "pembaruan sinkronisasi otomatis" },
  });
  console.log("Backup pengaman dibuat: " + safety.filename);
  for (const mode of ["internal", "eksternal"]) {
    const result = await db.$transaction(
      async (tx) => {
        const tables = [
          "customRow",
          "customCell",
          "customColumn",
          "customView",
        ];
        const before = await Promise.all(
          tables.map((table) =>
            tx[table].findMany({ where: { mode }, orderBy: { id: "asc" } }),
          ),
        );
        const result = await appendMasterRows(
          tx,
          mode,
          await tx.submission.findMany({
            where: { mode },
            orderBy: { submittedAt: "asc" },
          }),
        );
        for (let i = 0; i < tables.length; i++) {
          const ids = before[i].map((row) => row.id);
          const after = await tx[tables[i]].findMany({
            where: { mode, id: { in: ids } },
            orderBy: { id: "asc" },
          });
          assert.deepEqual(
            after,
            before[i],
            "Kustomisasi lama harus tetap sama: " + tables[i],
          );
        }
        await audit(
          {
            mode,
            ip: "lokal",
            admin: { email: "perubahan atas permintaan pengguna" },
          },
          "custom.backfill",
          null,
          result,
          mode,
          tx,
        );
        return result;
      },
      { timeout: 120000 },
    );
    console.log(JSON.stringify({ mode, ...result }));
  }
  await db.$transaction(async (tx) => {
    const before = await tx.setting.findMany({
      where: { key: { in: ["backup_jam", "backup_jam_kedua"] } },
    });
    for (const [key, value] of [
      ["backup_jam", "00:00"],
      ["backup_jam_kedua", "12:00"],
    ])
      await tx.setting.upsert({
        where: { key },
        create: { key, value },
        update: { value },
      });
    await audit(
      { ip: "lokal", admin: { email: "perubahan atas permintaan pengguna" } },
      "settings.backup_schedule",
      before,
      { backup_jam: "00:00", backup_jam_kedua: "12:00" },
      null,
      tx,
    );
  });
  console.log("Jadwal backup: 00:00 dan 12:00 sesuai zona waktu aplikasi.");
} finally {
  await db.$disconnect();
}
