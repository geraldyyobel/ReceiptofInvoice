import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";
import net from "node:net";
import { spawn, fork } from "node:child_process";
import { chromium } from "playwright";

const root = process.cwd(),
  count = 10000,
  dir = process.env.ROI_VOLUME_REUSE_DIR
    ? path.resolve(process.env.ROI_VOLUME_REUSE_DIR)
    : path.resolve("data", "volume-test-" + Date.now());
if (!dir.startsWith(path.resolve("data", "volume-test-")))
  throw Error("Direktori uji harus di data/volume-test-*");
const resultPath = path.resolve("test-results", "volume-10000.json");
await fs.mkdir(dir, { recursive: true });
await fs.mkdir(path.dirname(resultPath), { recursive: true });
const probe = net.createServer();
await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
const port = probe.address().port;
await new Promise((resolve) => probe.close(resolve));
const origin = "http://127.0.0.1:" + port;
const env = {
  ...process.env,
  NODE_ENV: "test",
  DATABASE_PROVIDER: "sqlite",
  DATABASE_URL: "file:" + path.join(dir, "volume.db").replaceAll("\\", "/"),
  DATA_DIR: dir,
  SESSION_SECRET: crypto.randomBytes(48).toString("hex"),
  ENCRYPTION_KEY: crypto.randomBytes(32).toString("hex"),
  ADMIN_EMAIL: "volume@example.test",
  ADMIN_PASSWORD: "VolumeUji!2026secure",
  APP_ORIGIN: origin,
  PORT: String(port),
  ROI_VOLUME_TEST: "1",
  ROI_VOLUME_COUNT: String(count),
};
const report = {
  startedAt: new Date().toISOString(),
  rowsPerMode: count,
  database: "SQLite",
  environment: {
    node: process.version,
    platform: process.platform,
    totalRamMB: Math.round(os.totalmem() / 1048576),
    initialFreeRamMB: Math.round(os.freemem() / 1048576),
    workerHeapLimitMB: 768,
    browserHeapLimitMB: 512,
  },
  fixtures: [],
  measurements: [],
  workers: [],
  notes: [
    "Data sintetis dibuat langsung melalui Prisma setelah validasi mesin form. Ini uji volume data, bukan simulasi 20.000 pengguna bersamaan.",
    "Seluruh data, backup dan restore memakai database uji terpisah. SMTP tidak dipanggil. Batas memori diterapkan karena RAM kosong mesin terbatas.",
  ],
};
let worker = null,
  jar = new Map(),
  mode = "internal",
  activeMode = "",
  backupId = null,
  failed = false;
async function persist() {
  await fs.writeFile(resultPath, JSON.stringify(report, null, 2));
}
function command(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: root,
      env,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0
        ? resolve()
        : reject(Error("Perintah uji gagal: " + args[0] + " (" + code + ")")),
    );
  });
}
function seed() {
  return new Promise((resolve, reject) => {
    const child = fork("scripts/volume-seed.js", [], {
      cwd: root,
      env,
      execArgv: ["--max-old-space-size=768"],
      stdio: ["ignore", "inherit", "inherit", "ipc"],
    });
    let data;
    child.on("message", (value) => (data = value));
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 && data
        ? resolve(data)
        : reject(Error("Seed volume gagal: " + code)),
    );
  });
}
async function stopWorker() {
  if (!worker) return;
  const current = worker;
  worker = null;
  activeMode = "";
  if (current.child.exitCode !== null) return;
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      current.controlledStop = true;
      current.child.kill();
      resolve();
    }, 2000);
    current.child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    try {
      current.child.send({ type: "stop" });
    } catch {
      clearTimeout(timer);
      current.child.kill();
      resolve();
    }
  });
}
async function startWorker() {
  const record = {
    startedAt: new Date().toISOString(),
    peakRssMB: 0,
    peakHeapMB: 0,
    controlledStop: false,
  };
  report.workers.push(record);
  const child = fork("scripts/volume-worker.js", [], {
    cwd: root,
    env,
    execArgv: ["--max-old-space-size=768"],
    stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
  const current = { child, record };
  worker = current;
  activeMode = "";
  child.stderr.on("data", (chunk) => {
    record.lastError = ((record.lastError || "") + chunk.toString()).slice(
      -2200,
    );
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(Error("Server uji tidak siap"));
    }, 20000);
    child.once("error", reject);
    child.on("message", (message) => {
      if (message.type === "ready") {
        clearTimeout(timer);
        resolve();
      }
      if (message.type === "memory") {
        record.peakRssMB = Math.max(
          record.peakRssMB,
          Math.round(message.rss / 1048576),
        );
        record.peakHeapMB = Math.max(
          record.peakHeapMB,
          Math.round(message.heapUsed / 1048576),
        );
      }
    });
    child.once("exit", (code, signal) => {
      record.exitCode = code;
      record.signal = signal;
      clearTimeout(timer);
      reject(Error("Server uji berhenti: " + code));
    });
  });
  await raw("/csrf");
  await raw("/auth/login", {
    method: "POST",
    body: { email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD },
  });
}
async function raw(
  route,
  { method = "GET", body, timeout = 45000, json = true } = {},
) {
  const headers = {
    Cookie: [...jar].map(([key, value]) => key + "=" + value).join("; "),
  };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    headers["X-CSRF-Token"] = jar.get("_csrf");
  }
  const response = await fetch(origin + "/api" + route, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
  });
  for (const cookie of response.headers.getSetCookie()) {
    const [pair] = cookie.split(";"),
      at = pair.indexOf("=");
    jar.set(pair.slice(0, at), pair.slice(at + 1));
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  let data;
  if (json) {
    data = JSON.parse(bytes.toString());
    if (route === "/csrf" && data.token) jar.set("_csrf", data.token);
  }
  if (!response.ok)
    throw Error(
      "HTTP " + response.status + ": " + (data?.error || "permintaan gagal"),
    );
  return { data, bytes: bytes.length, status: response.status };
}
async function ensure() {
  if (!worker || worker.child.exitCode !== null) await startWorker();
  if (activeMode !== mode) {
    await raw("/admin/mode", { method: "POST", body: { mode } });
    activeMode = mode;
  }
}
async function measure(name, fn) {
  await ensure();
  const start = performance.now(),
    item = { mode, name };
  report.measurements.push(item);
  console.log("Uji " + mode + ": " + name);
  try {
    const value = await fn();
    Object.assign(
      item,
      { status: "lulus", ms: Math.round(performance.now() - start) },
      value?.bytes !== undefined ? { bytes: value.bytes } : {},
    );
    if (value?.summary) item.summary = value.summary;
    return value;
  } catch (error) {
    item.status = "gagal";
    item.ms = Math.round(performance.now() - start);
    item.error = error.message;
    failed = true;
    if (
      error.name === "TimeoutError" ||
      error.message.includes("fetch failed") ||
      worker?.child.exitCode !== null
    ) {
      if (worker) worker.record.controlledStop = error.name === "TimeoutError";
      await stopWorker();
    }
  } finally {
    console.log(JSON.stringify(item));
    await persist();
  }
}
function assert(condition, message) {
  if (!condition) throw Error(message);
}
async function browserCheck() {
  await ensure();
  const browser = await chromium.launch({
    headless: true,
    args: ["--js-flags=--max-old-space-size=512"],
  });
  const errors = [];
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    });
    page.setDefaultTimeout(20000);
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(origin + "/admin");
    await page.getByLabel("Email", { exact: true }).fill(env.ADMIN_EMAIL);
    await page.getByLabel("Password", { exact: true }).fill(env.ADMIN_PASSWORD);
    await page.getByRole("button", { name: "Masuk →" }).click();
    await page
      .getByRole("button", {
        name: mode === "internal" ? /LINGKUNGAN BCU/ : /VENDOR & MITRA/,
      })
      .click();
    const start = performance.now();
    await page
      .locator("nav")
      .getByRole("button", { name: "Tabel Kustom", exact: false })
      .click();
    await page
      .locator(".custom-table tbody tr")
      .first()
      .waitFor({ timeout: 45000 });
    report.measurements.push({
      mode,
      name: "Browser: tabel kustom siap (50 baris terlihat)",
      status: "lulus",
      ms: Math.round(performance.now() - start),
    });
    await persist();
    await page.screenshot({
      path: path.resolve("test-results", `volume-${mode}-table.png`),
      fullPage: false,
      timeout: 15000,
    });
    const searchStart = performance.now();
    try {
      await page
        .getByRole("textbox", { name: "Cari tabel kustom" })
        .fill(`PT VOLUME ${mode.toUpperCase()} 10000`, { timeout: 20000 });
      await page.waitForFunction(
        () => document.querySelectorAll(".custom-table tbody tr").length === 1,
        {},
        { timeout: 20000 },
      );
      report.measurements.push({
        mode,
        name: "Browser: cari baris ke-10000",
        status: "lulus",
        ms: Math.round(performance.now() - searchStart),
      });
    } catch (error) {
      report.measurements.push({
        mode,
        name: "Browser: cari baris ke-10000",
        status: "gagal",
        ms: Math.round(performance.now() - searchStart),
        error: error.message.slice(0, 500),
      });
      failed = true;
    }
    if (errors.length)
      report.notes.push(mode + " browser error: " + errors.join("; "));
  } catch (error) {
    report.measurements.push({
      mode,
      name: "Browser: tabel kustom",
      status: "gagal",
      error: error.message.slice(0, 500),
    });
    failed = true;
  } finally {
    await browser.close();
    await persist();
  }
}

try {
  console.log("Database uji: " + dir);
  if (
    !(await fs.readFile("prisma/generated/schema.prisma", "utf8")).includes(
      'provider = "sqlite"',
    )
  )
    throw Error("Client lokal harus sudah disiapkan untuk SQLite");
  if (process.env.ROI_VOLUME_REUSE_DIR) {
    const previous = JSON.parse(await fs.readFile(resultPath, "utf8"));
    if (
      previous.retainedTestDirectory !== dir ||
      previous.fixtures?.some((f) => f.submissions !== count) ||
      previous.measurements?.length
    )
      throw Error(
        "Fixture yang dipakai ulang tidak sesuai atau sudah dipakai untuk pengujian aplikasi",
      );
    report.fixtures = previous.fixtures;
    report.seedMs = previous.seedMs;
    report.notes.push(
      "Fixture 10000 per mode dipakai ulang setelah koreksi port pada alat pengujian; pengujian aplikasi sebelumnya belum dimulai.",
    );
  } else {
    await command(["scripts/database.js", "migrate"]);
    await command(["prisma/seed.js"]);
    Object.assign(report, await seed());
  }
  report.databaseBytes = (await fs.stat(path.join(dir, "volume.db"))).size;
  await persist();
  await startWorker();
  for (mode of ["internal", "eksternal"]) {
    for (const [label, route] of [
      ["Master halaman pertama", "/admin/submissions?size=50&page=1"],
      ["Master halaman ke-200", "/admin/submissions?size=50&page=200"],
      [
        "Master cari baris ke-10000",
        "/admin/submissions?q=" +
          encodeURIComponent(`PT VOLUME ${mode.toUpperCase()} 10000`),
      ],
      [
        "Master sorting vendor",
        "/admin/submissions?sort=vendor&dir=asc&size=50",
      ],
      ["Custom halaman 50 baris", "/admin/custom"],
      ["Custom seluruh 10000 baris (dipakai UI)", "/admin/custom?all=1"],
    ])
      await measure(label, async () => {
        const r = await raw(route);
        assert(
          r.data.total === (label.includes("cari") ? 1 : 10000),
          "Jumlah baris tidak sesuai",
        );
        if (label.includes("cari"))
          assert(r.data.rows.length === 1, "Pencarian master tidak sesuai");
        return {
          bytes: r.bytes,
          summary: {
            rows: r.data.rows.length,
            total: r.data.total,
            cells: r.data.cells?.length,
          },
        };
      });
    const rowId = `vol-row-${mode}-00001`,
      columnId = `vol-col-${mode}-received_from`;
    await measure("Edit satu sel", () =>
      raw("/admin/custom/cell", {
        method: "PUT",
        body: { rowId, columnId, value: "EDIT VOLUME TETAP" },
      }),
    );
    for (const direction of ["undo", "redo"])
      await measure(direction, async () => {
        const h = (await raw("/admin/custom/history")).data;
        return raw("/admin/custom/" + direction, {
          method: "POST",
          body: { expectedId: h[direction + "Id"] },
        });
      });
    await measure("Sinkronisasi ulang tanpa baris baru", async () => {
      const r = await raw("/admin/custom/sync", {
        method: "POST",
        body: { confirm: "SINKRONISASI ULANG" },
        timeout: 90000,
      });
      assert(r.data.added === 0, "Sinkronisasi menggandakan baris");
      return r;
    });
    await browserCheck();
    for (const type of ["csv", "xlsx"]) {
      await measure("Ekspor master " + type, () =>
        raw("/admin/submissions/export/" + type, {
          json: false,
          timeout: 45000,
        }),
      );
      await measure("Ekspor custom " + type, () =>
        raw("/admin/custom/export/" + type, { json: false, timeout: 30000 }),
      );
    }
    await measure("Submit baru: otomatis menambah baris", async () => {
      const form = (await raw("/public/" + mode + "/form")).data;
      const values = {
        paham_ketentuan: "Ya",
        email_anda:
          mode === "internal" ? "annie.la@bcupt.id" : "volume-new@example.test",
        received_from: "PT VOLUME BARU " + mode,
        invoice_number: "INV-VOL-NEW-" + mode,
        invoice_date: new Date().toISOString().slice(0, 10),
        currency: "IDR",
        amount_nett: 123.45,
        ada_ppn: "Tidak",
        invoice_jasa: "Tidak",
        ada_subvendor_1: "Tidak",
        legalitas_terkirim: "Belum",
        permintaan_via: "Email",
        po_number: "PO-VOLUME-NEW",
      };
      const r = await raw("/public/" + mode + "/submit", {
        method: "POST",
        body: {
          formVersionId: form.form.id,
          termsVersionId: form.termsVersionId,
          termsRevision: form.termsRevision,
          accepted: true,
          startedAt: new Date().toISOString(),
          values,
        },
      });
      const table = (await raw("/admin/custom")).data;
      assert(table.total === 10001, "Baris baru tidak masuk");
      const existing = (await raw("/admin/custom")).data.cells.find(
        (c) => c.rowId === rowId && c.columnId === columnId,
      );
      assert(
        existing?.value === "EDIT VOLUME TETAP",
        "Edit sebelumnya tertimpa",
      );
      return {
        bytes: r.bytes,
        summary: { reference: r.data.reference, customRows: table.total },
      };
    });
  }
  mode = "eksternal";
  const backup = await measure("Backup seluruh database 20000+ baris", () =>
    raw("/admin/backups", { method: "POST", body: {}, timeout: 120000 }),
  );
  backupId = backup?.data?.id;
  if (backupId) {
    for (mode of ["internal", "eksternal"])
      await measure("Baca snapshot backup tabel", async () => {
        const r = await raw("/admin/custom/backups/" + backupId, {
          timeout: 90000,
        });
        assert(r.data.rows.length === 10001, "Snapshot tidak lengkap");
        assert(
          r.data.rows.every((row) => row.mode === mode),
          "Snapshot bocor mode",
        );
        return {
          bytes: r.bytes,
          summary: { rows: r.data.rows.length, cells: r.data.cells.length },
        };
      });
    mode = "eksternal";
    await measure("Restore backup dan jumlah baris tetap", async () => {
      await raw("/admin/custom/rows", { method: "POST", body: {} });
      const ticket = (
        await raw("/admin/backups/" + backupId + "/prepare-restore", {
          method: "POST",
          body: {},
        })
      ).data;
      const r = await raw("/admin/backups/" + backupId + "/restore", {
        method: "POST",
        body: { token: ticket.token, confirm: ticket.phrase },
        timeout: 180000,
      });
      await raw("/auth/login", {
        method: "POST",
        body: { email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD },
      });
      await raw("/admin/mode", { method: "POST", body: { mode } });
      for (const selectedMode of ["internal", "eksternal"]) {
        await raw("/admin/mode", {
          method: "POST",
          body: { mode: selectedMode },
        });
        assert(
          (await raw("/admin/custom")).data.total === 10001,
          "Restore tidak mengembalikan jumlah baris " + selectedMode,
        );
      }
      return r;
    });
  }
  report.status = failed
    ? "Ada hambatan pada uji volume"
    : "Seluruh pemeriksaan volume lulus";
} catch (error) {
  report.status = "Pengujian terhenti";
  report.error = error.stack;
  console.log(error.stack);
} finally {
  await stopWorker();
  report.finishedAt = new Date().toISOString();
  report.retainedTestDirectory = dir;
  await persist();
  // Keep the isolated database for repeatable investigation; no production files are deleted.
  console.log("HASIL: " + report.status);
  console.log("Laporan JSON: " + resultPath);
  process.exitCode = failed || report.error ? 1 : 0;
}
