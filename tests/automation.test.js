import { test, after } from "node:test";
import assert from "node:assert/strict";
import { latestBackupSlot } from "../shared/backup-schedule.js";
import { createBackupScheduler } from "../server/backup-scheduler.js";
import { db, inTimezone } from "../server/core.js";
import { createBackup } from "../server/backup.js";
import { swapUploadFolders } from "../server/upload-swap.js";
after(() => db.$disconnect());

test("restore memulihkan folder asli jika pemasangan upload gagal", async () => {
  const folders = new Map([
    ["uploads", "asli"],
    ["staging", "cadangan"],
  ]);
  const move = async (from, to) => {
    if (from === "staging") throw Error("uji folder terkunci");
    if (!folders.has(from) || folders.has(to))
      throw Error("perpindahan tidak valid");
    folders.set(to, folders.get(from));
    folders.delete(from);
  };
  await assert.rejects(
    swapUploadFolders("staging", "uploads", "previous", move),
    /folder terkunci/,
  );
  assert.equal(folders.get("uploads"), "asli");
  assert.equal(folders.get("staging"), "cadangan");
  assert.equal(folders.has("previous"), false);
});

test("slot backup tengah malam/siang mengikuti zona waktu dan pergantian tanggal", () => {
  const slots = ["00:00", "12:00"];
  for (const [time, expected] of [
    ["2026-11-03 00:00", "2026-11-03 00:00"],
    ["2026-11-03 11:59", "2026-11-03 00:00"],
    ["2026-11-03 12:00", "2026-11-03 12:00"],
    ["2026-11-03 23:59", "2026-11-03 12:00"],
    ["2026-11-04 00:00", "2026-11-04 00:00"],
  ])
    assert.equal(latestBackupSlot(time, slots), expected);
  assert.equal(
    latestBackupSlot("2027-01-01 00:01", ["02:00", "14:00"]),
    "2026-12-31 14:00",
  );
  assert.equal(
    latestBackupSlot(
      inTimezone(new Date("2026-11-03T05:00:00Z"), "Asia/Jakarta"),
      slots,
    ),
    "2026-11-03 12:00",
  );
  assert.throws(() => latestBackupSlot("2026-11-03 00:00", ["24:00"]));
});

function fakeScheduler() {
  let marker = null,
    failures = 0,
    hold = null;
  const calls = [],
    deps = {
      settings: async () => ({
        zona_waktu: "Asia/Jakarta",
        backup_jam: "00:00",
        backup_jam_kedua: "12:00",
      }),
      db: {
        setting: {
          findUnique: async () => (marker ? { value: marker } : null),
        },
      },
      createBackup: async ({ scheduledSlot }) => {
        calls.push(scheduledSlot);
        if (hold) await hold;
        if (failures) {
          failures--;
          throw Error("uji gagal");
        }
        marker = scheduledSlot;
        return { id: scheduledSlot };
      },
      retention: async () => {},
    };
  return { deps, calls, fail: () => failures++, hold: (p) => (hold = p) };
}
test("scheduler menjalankan dua backup sehari, tidak mengulang setelah restart, dan mengejar slot terakhir", async () => {
  const f = fakeScheduler(),
    run = createBackupScheduler(f.deps);
  await run(new Date("2026-11-02T17:00:00Z"));
  await run(new Date("2026-11-02T17:01:00Z"));
  await run(new Date("2026-11-03T05:00:00Z"));
  await createBackupScheduler(f.deps)(new Date("2026-11-03T06:00:00Z"));
  await run(new Date("2026-11-04T06:00:00Z"));
  assert.deepEqual(f.calls, [
    "2026-11-03 00:00",
    "2026-11-03 12:00",
    "2026-11-04 12:00",
  ]);
});
test("scheduler mengulang kegagalan di menit berikutnya dan mencegah proses bertumpuk", async () => {
  const f = fakeScheduler(),
    run = createBackupScheduler(f.deps),
    now = new Date("2026-11-03T05:00:00Z");
  f.fail();
  await assert.rejects(run(now), /uji gagal/);
  await run(new Date(now.getTime() + 60000));
  assert.equal(f.calls.length, 2);
  let release;
  f.hold(new Promise((r) => (release = r)));
  const next = run(new Date("2026-11-03T17:00:00Z"));
  assert.equal((await run(new Date("2026-11-03T17:01:00Z"))).skipped, true);
  release();
  await next;
  assert.equal(f.calls.length, 3);
});
test("backup manual tidak mengubah penanda slot; arsip terjadwal sukses menyimpannya", async () => {
  const old = await db.setting.findUnique({
    where: { key: "backup_last_slot" },
  });
  try {
    await db.setting.deleteMany({ where: { key: "backup_last_slot" } });
    await createBackup();
    assert.equal(
      await db.setting.findUnique({ where: { key: "backup_last_slot" } }),
      null,
    );
    const scheduled = await createBackup({ scheduledSlot: "2026-11-03 12:00" });
    assert.equal(
      (await db.setting.findUnique({ where: { key: "backup_last_slot" } }))
        .value,
      "2026-11-03 12:00",
    );
    await createBackup();
    assert.equal(
      (await db.setting.findUnique({ where: { key: "backup_last_slot" } }))
        .value,
      "2026-11-03 12:00",
    );
    assert.ok(
      (
        await db.activityLog.findMany({ where: { action: "backup.create" } })
      ).some(
        (log) =>
          log.after?.id === scheduled.id &&
          log.after.scheduledSlot === "2026-11-03 12:00",
      ),
    );
  } finally {
    await db.setting.deleteMany({ where: { key: "backup_last_slot" } });
    if (old) await db.setting.create({ data: old });
  }
});
