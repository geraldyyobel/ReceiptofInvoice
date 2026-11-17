import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

export function ensureLocalPostgres() {
  if (
    process.env.DATABASE_PROVIDER !== "postgresql" ||
    !process.env.LOCAL_POSTGRES_DIR
  )
    return;
  const dir = path.resolve(process.env.LOCAL_POSTGRES_DIR),
    bin = process.env.LOCAL_POSTGRES_BIN;
  if (!bin || !fs.existsSync(path.join(dir, "PG_VERSION")))
    throw Error("PostgreSQL lokal belum disiapkan. Lihat POSTGRESQL.md.");
  const pgctl = path.join(
    bin,
    process.platform === "win32" ? "pg_ctl.exe" : "pg_ctl",
  );
  const status = spawnSync(pgctl, ["-D", dir, "status"], {
    windowsHide: true,
    encoding: "utf8",
  });
  if (status.status === 0) return;
  const log = path.resolve(dir, "..", "postgresql.log");
  const started = spawnSync(
    pgctl,
    ["-D", dir, "-l", log, "-w", "-t", "45", "start"],
    { windowsHide: true, encoding: "utf8", timeout: 60000 },
  );
  if (started.status !== 0)
    throw Error(
      "PostgreSQL lokal gagal dinyalakan. Periksa data/postgresql.log.",
    );
  console.log("PostgreSQL lokal aktif.");
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve("scripts/local-postgres.js")
)
  ensureLocalPostgres();
