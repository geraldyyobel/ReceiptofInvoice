import { db, settings, inTimezone } from "./core.js";
import { createBackup, retention } from "./backup.js";
import { latestBackupSlot } from "../shared/backup-schedule.js";
export function createBackupScheduler(
  deps = { db, settings, createBackup, retention },
) {
  let running = false;
  return async (now = new Date()) => {
    if (running) return { skipped: true };
    running = true;
    try {
      const s = await deps.settings(),
        slot = latestBackupSlot(inTimezone(now, s.zona_waktu), [
          s.backup_jam || "00:00",
          s.backup_jam_kedua || "12:00",
        ]);
      const previous = await deps.db.setting.findUnique({
        where: { key: "backup_last_slot" },
      });
      if (previous?.value >= slot) return { skipped: true, slot };
      // createBackup persists the slot marker atomically with the successful archive record.
      const backup = await deps.createBackup({ scheduledSlot: slot });
      await deps.retention();
      return { slot, backup };
    } finally {
      running = false;
    }
  };
}
