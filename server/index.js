import { app } from "./app.js";
import cron from "node-cron";
import { db } from "./core.js";
import { createBackupScheduler } from "./backup-scheduler.js";
import { closeBrowser } from "./documents.js";
const server = app.listen(Number(process.env.PORT) || 3000, "0.0.0.0", () =>
  console.log(`ROI BCU aktif di http://localhost:${process.env.PORT || 3000}`),
);
const runScheduledBackup = createBackupScheduler();
async function checkBackup() {
  try {
    await runScheduledBackup();
  } catch (e) {
    console.error("Backup terjadwal gagal:", e.message);
  }
}
const scheduler = cron.schedule("* * * * *", checkBackup);
// Catch up the latest missed slot after a restart, without replaying older slots.
void checkBackup();
async function stop() {
  scheduler.stop();
  server.close();
  await closeBrowser();
  await db.$disconnect();
  process.exit(0);
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
