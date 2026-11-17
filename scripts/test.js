import { spawnSync } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
const dir = path.resolve("data", "test-" + Date.now());
await mkdir(dir, { recursive: true });
const env = {
  ...process.env,
  NODE_ENV: "test",
  DATABASE_PROVIDER: "sqlite",
  DATABASE_URL: "file:" + path.join(dir, "test.db").replaceAll("\\", "/"),
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
  ["node_modules/vite/bin/vite.js", "build"],
  [
    "--test",
    "--test-concurrency=1",
    "tests/engine.test.js",
    "tests/automation.test.js",
    "tests/integration.test.js",
    "tests/templates.test.js",
    "tests/mail-oauth.test.js",
    "tests/browser.test.js",
    "tests/public-storage.test.js",
    "tests/custom-query.test.js",
    "tests/review-regressions.test.js",
    "tests/notifications.test.js",
    "tests/dashboard.test.js",
    "tests/ui-races.test.js",
    "tests/auth-races.test.js",
  ],
]) {
  const r = spawnSync(process.execPath, args, {
    env:
      args[0] === "node_modules/vite/bin/vite.js"
        ? { ...env, NODE_ENV: "production" }
        : env,
    stdio: "inherit",
  });
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
// Restore the runtime provider after the isolated SQLite suite.
const restored = spawnSync(
  process.execPath,
  ["scripts/database.js", "prepare"],
  { stdio: "inherit", env: process.env },
);
process.exit(status || restored.status || 0);
