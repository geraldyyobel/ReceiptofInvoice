import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { encrypt, decrypt, db } from "../server/core.js";

const bin =
  process.env.LOCAL_POSTGRES_BIN || "C:/Program Files/PostgreSQL/17/bin";
const parent = path.resolve(process.env.DATA_DIR || "./data"),
  dir = path.join(parent, "postgresql"),
  port = Number(process.env.LOCAL_POSTGRES_PORT || 5543);
const privateFile = path.join(parent, "postgresql-local.enc");
const executable = (name) =>
  path.join(bin, name + (process.platform === "win32" ? ".exe" : ""));
function run(name, args, extra = {}) {
  const result = spawnSync(executable(name), args, {
    windowsHide: true,
    encoding: "utf8",
    timeout: 60000,
    ...extra,
  });
  if (result.status !== 0)
    throw Error(
      name +
        " gagal: " +
        (result.stderr || result.error?.message || result.stdout),
    );
  return result.stdout;
}
try {
  await fs.mkdir(parent, { recursive: true });
  let saved;
  try {
    saved = JSON.parse(decrypt(await fs.readFile(privateFile)).toString());
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  if (!saved) {
    try {
      await fs.access(path.join(dir, "PG_VERSION"));
      throw Error(
        "Cluster sudah ada tanpa konfigurasi proyek; tidak akan ditimpa.",
      );
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    saved = {
      bin,
      dir,
      port,
      owner: "roi_owner",
      ownerPassword: crypto.randomBytes(32).toString("hex"),
      user: "roi_bcu",
      password: crypto.randomBytes(32).toString("hex"),
      database: "roi_bcu",
    };
    await fs.writeFile(privateFile, encrypt(JSON.stringify(saved)), {
      flag: "wx",
    });
  }
  if (saved.port !== port) {
    const oldStatus = spawnSync(executable("pg_ctl"), ["-D", dir, "status"], {
      windowsHide: true,
      encoding: "utf8",
    });
    if (oldStatus.status === 0)
      throw Error("Hentikan instance lokal proyek sebelum mengganti port.");
    saved.port = port;
    await fs.writeFile(privateFile, encrypt(JSON.stringify(saved)));
    await fs.appendFile(path.join(dir, "postgresql.conf"), `\nport=${port}\n`);
  }
  try {
    await fs.access(path.join(dir, "PG_VERSION"));
  } catch {
    const passwordFile = path.join(
      parent,
      "pg-init-password-" + crypto.randomUUID() + ".txt",
    );
    await fs.writeFile(passwordFile, saved.ownerPassword, { flag: "wx" });
    try {
      run("initdb", [
        "-D",
        dir,
        "-U",
        saved.owner,
        "--pwfile=" + passwordFile,
        "--auth=scram-sha-256",
        "--encoding=UTF8",
        "--locale=C",
      ]);
    } finally {
      await fs.unlink(passwordFile);
    }
    await fs.appendFile(
      path.join(dir, "postgresql.conf"),
      `\n# Dedicated local ROI instance\nlisten_addresses='127.0.0.1'\nport=${port}\nshared_buffers='64MB'\nwork_mem='4MB'\nmax_connections=40\ntimezone='Asia/Jakarta'\n`,
    );
  }
  const status = spawnSync(executable("pg_ctl"), ["-D", dir, "status"], {
    windowsHide: true,
    encoding: "utf8",
  });
  if (status.status !== 0)
    run("pg_ctl", [
      "-D",
      dir,
      "-l",
      path.join(parent, "postgresql.log"),
      "-w",
      "-t",
      "45",
      "start",
    ]);
  const sqlArgs = [
    "-h",
    "127.0.0.1",
    "-p",
    String(port),
    "-U",
    saved.owner,
    "-d",
    "postgres",
    "-v",
    "ON_ERROR_STOP=1",
    "-tA",
  ];
  const pgEnv = { ...process.env, PGPASSWORD: saved.ownerPassword };
  if (
    !run(
      "psql",
      [...sqlArgs, "-c", "SELECT 1 FROM pg_roles WHERE rolname='roi_bcu'"],
      { env: pgEnv },
    ).trim()
  )
    run("psql", sqlArgs, {
      env: pgEnv,
      input: `CREATE ROLE roi_bcu LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '${saved.password}';`,
    });
  if (
    !run(
      "psql",
      [...sqlArgs, "-c", "SELECT 1 FROM pg_database WHERE datname='roi_bcu'"],
      { env: pgEnv },
    ).trim()
  )
    run("psql", sqlArgs, {
      env: pgEnv,
      input:
        "CREATE DATABASE roi_bcu OWNER roi_bcu ENCODING 'UTF8' TEMPLATE template0;",
    });
  if (process.argv.includes("--configure")) {
    const updates = {
      DATABASE_PROVIDER: "postgresql",
      DATABASE_URL: `postgresql://${saved.user}:${saved.password}@127.0.0.1:${saved.port}/${saved.database}?schema=public&connection_limit=8`,
      LOCAL_POSTGRES_DIR: "./data/postgresql",
      LOCAL_POSTGRES_BIN: saved.bin,
      LOCAL_POSTGRES_PORT: String(saved.port),
      POSTGRES_USER: saved.user,
      POSTGRES_PASSWORD: saved.password,
      POSTGRES_DB: saved.database,
    };
    let contents = await fs.readFile(".env", "utf8");
    for (const [key, value] of Object.entries(updates)) {
      const regex = new RegExp("^" + key + "=.*$", "m");
      contents = regex.test(contents)
        ? contents.replace(regex, () => key + "=" + value)
        : contents.trimEnd() + "\n" + key + "=" + value + "\n";
    }
    await fs.writeFile(".env", contents);
  }
  console.log(
    JSON.stringify({
      ready: true,
      version: run("postgres", ["--version"]).trim(),
      host: "127.0.0.1",
      port,
      database: saved.database,
      credentialsFile: "data/postgresql-local.enc",
      cluster: dir,
    }),
  );
} finally {
  await db.$disconnect();
}
