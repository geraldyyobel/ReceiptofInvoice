import { spawnSync } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
const provider = process.argv[2];
if (
  !["postgresql", "mysql"].includes(provider) ||
  !process.env.TEST_DATABASE_URL
)
  throw Error(
    "Gunakan node scripts/provider-test.js postgresql|mysql dengan TEST_DATABASE_URL ke DATABASE UJI KOSONG",
  );
const dir = path.resolve("data", "provider-test-" + Date.now());
await mkdir(dir, { recursive: true });
const env = {
  ...process.env,
  NODE_ENV: "test",
  DATABASE_PROVIDER: provider,
  DATABASE_URL: process.env.TEST_DATABASE_URL,
  DATA_DIR: dir,
  SESSION_SECRET: crypto.randomBytes(48).toString("hex"),
  ENCRYPTION_KEY: crypto.randomBytes(32).toString("hex"),
  ADMIN_EMAIL: "test@bcupt.id",
  ADMIN_PASSWORD: "TestBCU!2026secure",
  APP_ORIGIN: "http://localhost:5173",
};
let status = 0;
for (const args of [
  ["scripts/database.js", "prepare"],
  ["scripts/database.js", "migrate"],
  ["prisma/seed.js"],
  ["--test", "tests/integration.test.js"],
]) {
  const r = spawnSync(process.execPath, args, { env, stdio: "inherit" });
  if (r.status) {
    status = r.status;
    break;
  }
}
if (dir.startsWith(path.resolve("data") + path.sep))
  await rm(dir, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 200,
  });
// Put local client back on the provider in .env after the isolated test process exits.
const restored = spawnSync(
  process.execPath,
  ["scripts/database.js", "prepare"],
  { stdio: "inherit" },
);
process.exit(status || restored.status || 0);
