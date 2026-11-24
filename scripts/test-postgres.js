import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { ensureLocalPostgres } from "./local-postgres.js";
import { decrypt, db } from "../server/core.js";
const testFiles = [
  "tests/engine.test.js", "tests/automation.test.js", "tests/integration.test.js",
  "tests/templates.test.js", "tests/browser.test.js",
  "tests/email-placeholders.test.js",
  "tests/admin-routes.test.js",
  "tests/mode-routing.test.js",
  "tests/smtp-only.test.js",
  "tests/public-storage.test.js",
  "tests/custom-query.test.js",
  "tests/custom-review.test.js",
  "tests/custom-review-performance.test.js",
  "tests/review-regressions.test.js",
  "tests/notifications.test.js",
  "tests/dashboard.test.js",
    "tests/ui-races.test.js",
    "tests/auth-races.test.js",
    "tests/admin-otp.test.js",
    "tests/terms-font.test.js",
    "tests/terms-images.test.js",
    "tests/terms-rollback.test.js",
];
const requestedTests = process.argv.slice(2);
if (requestedTests.some((file) => !testFiles.includes(file)))
  throw Error("Pilih file tes yang terdaftar pada runner PostgreSQL.");
ensureLocalPostgres();
const cfg = JSON.parse(
  decrypt(await fs.readFile("data/postgresql-local.enc")).toString(),
);
const name = "roi_test_" + Date.now(),
  dir = path.resolve("data", "postgres-test-" + Date.now());
await fs.mkdir(dir, { recursive: true });
const psql = path.join(
  cfg.bin,
  process.platform === "win32" ? "psql.exe" : "psql",
);
function sql(command) {
  const result = spawnSync(
    psql,
    [
      "-h",
      "127.0.0.1",
      "-p",
      String(cfg.port),
      "-U",
      cfg.owner,
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
    ],
    {
      env: { ...process.env, PGPASSWORD: cfg.ownerPassword },
      input: command,
      encoding: "utf8",
      windowsHide: true,
    },
  );
  if (result.status) throw Error("Database uji PostgreSQL: " + result.stderr);
}
const env = {
  ...process.env,
  NODE_ENV: "test",
  DATABASE_PROVIDER: "postgresql",
  DATABASE_URL: `postgresql://${cfg.user}:${cfg.password}@127.0.0.1:${cfg.port}/${name}?schema=public&connection_limit=8`,
  DATA_DIR: dir,
  SESSION_SECRET: crypto.randomBytes(48).toString("hex"),
  ENCRYPTION_KEY: crypto.randomBytes(32).toString("hex"),
  ADMIN_EMAIL: "test@bcupt.id",
  ADMIN_PASSWORD: "TestBCU!2026secure",
  APP_ORIGIN: "http://localhost:5173",
  LOCAL_POSTGRES_DIR: "",
};
let status = 0;
try {
  sql(`CREATE DATABASE ${name} OWNER roi_bcu TEMPLATE template0;`);
  for (const args of [
    ["scripts/database.js", "migrate"],
    ["prisma/seed.js"],
    ["node_modules/vite/bin/vite.js", "build"],
    [
      "--test",
      "--test-concurrency=1",
      ...(requestedTests.length ? requestedTests : testFiles),
    ],
  ]) {
    const result = spawnSync(process.execPath, args, {
      env: args[0].includes("vite") ? { ...env, NODE_ENV: "production" } : env,
      stdio: "inherit",
      windowsHide: true,
    });
    if (result.status) {
      status = result.status;
      break;
    }
  }
} finally {
  sql(`DROP DATABASE IF EXISTS ${name} WITH (FORCE);`);
  if (dir.startsWith(path.resolve("data") + path.sep))
    await fs.rm(dir, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 200,
    });
  await db.$disconnect();
}
process.exitCode = status;
