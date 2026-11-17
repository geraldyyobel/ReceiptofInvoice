import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { parse } from "dotenv";
if (!existsSync(".env")) {
  const password = randomBytes(18).toString("base64url") + "aA1!";
  writeFileSync(
    ".env",
    readFileSync(".env.example", "utf8")
      .replace(
        "REPLACE_WITH_AT_LEAST_48_RANDOM_CHARACTERS",
        randomBytes(48).toString("hex"),
      )
      .replace(
        "REPLACE_WITH_64_HEXADECIMAL_CHARACTERS",
        randomBytes(32).toString("hex"),
      )
      .replace("REPLACE_WITH_A_STRONG_INITIAL_PASSWORD", password)
      .replaceAll(
        "REPLACE_WITH_POSTGRES_PASSWORD",
        randomBytes(32).toString("hex"),
      )
      .replaceAll(
        "REPLACE_WITH_POSTGRES_ADMIN_PASSWORD",
        randomBytes(32).toString("hex"),
      ),
  );
  console.log(
    "Environment dibuat. Password admin awal tersimpan di .env (ADMIN_PASSWORD).",
  );
}
const local = parse(readFileSync(".env", "utf8"));
const steps = [["scripts/database.js", "prepare"]];
if (
  (process.env.DATABASE_PROVIDER || local.DATABASE_PROVIDER) === "postgresql" &&
  (process.env.LOCAL_POSTGRES_DIR || local.LOCAL_POSTGRES_DIR)
)
  steps.push(["scripts/bootstrap-local-postgres.js", "--configure"]);
steps.push(["scripts/database.js", "migrate"], ["prisma/seed.js"]);
for (const args of steps) {
  const r = spawnSync(process.execPath, args, { stdio: "inherit" });
  if (r.status) process.exit(r.status);
}
