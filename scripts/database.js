import "dotenv/config";
import { readFile, writeFile, mkdir, appendFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
const provider = process.env.DATABASE_PROVIDER || "sqlite";
if (!["sqlite", "postgresql", "mysql"].includes(provider))
  throw Error("DATABASE_PROVIDER tidak didukung");
const base = "prisma/generated";
await mkdir(base, { recursive: true });
await mkdir(process.env.DATA_DIR || "data", { recursive: true });
let schema = (await readFile("prisma/schema.prisma", "utf8")).replace(
  'provider = "sqlite"',
  `provider = "${provider}"`,
);
// SQL text columns must hold rich HTML and large form payloads on MySQL.
if (provider === "mysql") {
  schema = schema.replace(
    /^(\s+(?:html|draft|note|message|vendor|filename|originalName|error|recipient|actor|label|name)\s+String\??)(.*)$/gm,
    "$1 @db.LongText$2",
  );
  schema = schema.replace(
    /^(\s+email\s+String)(.*)$/gm,
    (_, field, rest) =>
      field +
      (rest.includes("@unique") ? " @db.VarChar(254)" : " @db.LongText") +
      rest,
  );
}
await writeFile(`${base}/schema.prisma`, schema);
const run = (args) => {
  const r = spawnSync(
    process.execPath,
    ["node_modules/prisma/build/index.js", ...args],
    { stdio: "inherit" },
  );
  if (r.status) process.exit(r.status);
};
const command = process.argv[2];
if (provider === "sqlite" && command === "migrate") {
  const location = path.resolve(
    base,
    (process.env.DATABASE_URL || "file:../../data/roi.db")
      .slice(5)
      .split("?")[0],
  );
  await mkdir(path.dirname(location), { recursive: true });
  await appendFile(location, "");
}
if (command === "prepare")
  run(["generate", "--schema", `${base}/schema.prisma`]);
if (command === "migration:create") {
  const dir = `prisma/migrations-${provider}/202610300001_initial`;
  await mkdir(dir, { recursive: true });
  const r = spawnSync(
    process.execPath,
    [
      "node_modules/prisma/build/index.js",
      "migrate",
      "diff",
      "--from-empty",
      "--to-schema-datamodel",
      `${base}/schema.prisma`,
      "--script",
    ],
    { encoding: "utf8" },
  );
  if (r.status) throw Error(r.stderr);
  await writeFile(`${dir}/migration.sql`, r.stdout);
  await writeFile(
    `prisma/migrations-${provider}/migration_lock.toml`,
    `provider = "${provider}"\n`,
  );
}
if (command === "migrate") {
  const { cp, rm } = await import("node:fs/promises");
  const target = path.resolve(base, "migrations");
  if (target !== path.resolve("prisma/generated/migrations"))
    throw Error("Path salah");
  await rm(target, { recursive: true, force: true });
  await cp(`prisma/migrations-${provider}`, target, { recursive: true });
  run(["migrate", "deploy", "--schema", `${base}/schema.prisma`]);
  const { ensureBookkeeping } = await import("../server/bookkeeping.js");
  const { db } = await import("../server/core.js");
  try { await ensureBookkeeping(); } finally { await db.$disconnect(); }
}
