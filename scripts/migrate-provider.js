import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import { db, encrypt, decrypt, audit } from "../server/core.js";
import { Prisma } from "@prisma/client";

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
  "customHistory",
  "docTemplate",
  "templateVersion",
  "upload",
  "activityLog",
  "emailLog",
  "backup",
  "setting",
  "adminNotification",
  "adminNotificationRecipient",
];
const dates = {
  adminNotification: ["createdAt", "dueAt", "canceledAt"],
  adminNotificationRecipient: ["readAt"],
  admin: ["createdAt"],
  termsVersion: ["createdAt"],
  formVersion: ["createdAt"],
  submission: ["startedAt", "submittedAt"],
  customRow: ["createdAt"],
  customHistory: ["updatedAt"],
  templateVersion: ["createdAt"],
  upload: ["createdAt"],
  activityLog: ["createdAt"],
  emailLog: ["createdAt"],
  backup: ["createdAt"],
};
const jsonFields = {
  formVersion: ["fields", "sections"],
  formField: ["definition"],
  submission: ["documentSettings", "values"],
  submissionValue: ["value"],
  customColumn: ["options"],
  customCell: ["value"],
  customView: ["config"],
  customHistory: ["undo", "redo"],
  activityLog: ["before", "after"],
  setting: ["value"],
};
const filename = process.argv[3],
  action = process.argv[2];
if (!filename || !["export", "import"].includes(action))
  throw Error(
    "Gunakan: node scripts/migrate-provider.js export|import data/migrations/nama.enc",
  );
const file = path.resolve(filename);
if (!file.startsWith(path.resolve("data", "migrations") + path.sep))
  throw Error("Arsip migrasi wajib di data/migrations/");
const sort = (rows) =>
  rows
    .map((row) => JSON.parse(JSON.stringify(row)))
    .sort((a, b) =>
      String(a.id || a.key || a.mode).localeCompare(
        String(b.id || b.key || b.mode),
      ),
    );
try {
  if (action === "export") {
    const snapshot = await db.$transaction(
      async (tx) => {
        const data = {};
        for (const table of tables) data[table] = await tx[table].findMany();
        return data;
      },
      { timeout: 120000 },
    );
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(
      file,
      encrypt(
        JSON.stringify({
          version: 1,
          createdAt: new Date(),
          source: process.env.DATABASE_PROVIDER || "sqlite",
          tables: snapshot,
        }),
      ),
      { flag: "wx" },
    );
    console.log(
      JSON.stringify({
        action,
        tables: Object.fromEntries(tables.map((t) => [t, snapshot[t].length])),
        encrypted: true,
      }),
    );
  } else {
    const snapshot = JSON.parse(decrypt(await fs.readFile(file)).toString());
    if (snapshot.tables) for (const table of ["adminNotification", "adminNotificationRecipient"])
      if (snapshot.tables[table] === undefined) snapshot.tables[table] = [];
    if (
      snapshot.version !== 1 ||
      tables.some((t) => !Array.isArray(snapshot.tables?.[t]))
    )
      throw Error("Arsip migrasi tidak valid");
    await db.$transaction(
      async (tx) => {
        for (const table of tables)
          if (await tx[table].count())
            throw Error("Database tujuan harus kosong: " + table);
        for (const table of tables) {
          for (
            let offset = 0;
            offset < snapshot.tables[table].length;
            offset += 200
          ) {
            const batch = snapshot.tables[table]
              .slice(offset, offset + 200)
              .map((row) => {
                const data = { ...row };
                for (const field of dates[table] || [])
                  if (data[field]) data[field] = new Date(data[field]);
                for (const field of jsonFields[table] || [])
                  if (data[field] === null)
                    data[field] =
                      table === "activityLog" ? Prisma.DbNull : Prisma.JsonNull;
                return data;
              });
            await tx[table].createMany({ data: batch });
          }
        }
        for (const table of tables)
          assert.deepEqual(
            sort(await tx[table].findMany()),
            sort(snapshot.tables[table]),
            "Verifikasi migrasi: " + table,
          );
        await audit(
          {
            admin: { email: "migrasi database atas permintaan pengguna" },
            ip: "lokal",
          },
          "database.migrate",
          null,
          {
            source: snapshot.source,
            target: process.env.DATABASE_PROVIDER,
            tables: Object.fromEntries(
              tables.map((t) => [t, snapshot.tables[t].length]),
            ),
          },
          null,
          tx,
        );
      },
      { timeout: 180000, isolationLevel: "Serializable" },
    );
    console.log(
      JSON.stringify({
        action,
        verified: true,
        sessionsMigrated: false,
        checksum: crypto
          .createHash("sha256")
          .update(JSON.stringify(snapshot.tables))
          .digest("hex"),
      }),
    );
  }
} finally {
  await db.$disconnect();
}
