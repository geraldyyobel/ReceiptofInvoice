import "dotenv/config";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import ExcelJS from "exceljs";
import { chromium } from "playwright";

// Read existing tables; the only writes are normal login/logout/export audit logs.
const origin = `http://localhost:${Number(process.env.PORT) || 3000}`;
const jar = new Map(), output = path.resolve("test-results/custom-performance-after.json");
const temporary = path.resolve(process.env.DATA_DIR || "data", "performance-downloads");
const report = { at: new Date().toISOString(), origin, database: process.env.DATABASE_PROVIDER,
  notes: ["Data aktif hanya dibaca. Tiga sampel per kueri; satu ekspor per format/mode. Bukan uji banyak pengguna serentak."], modes: {} };
let csrf;
async function request(url, body) {
  const response = await fetch(origin + "/api" + url, {
    method: body ? "POST" : "GET", signal: AbortSignal.timeout(45000),
    headers: { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; "),
      ...(body ? { "content-type": "application/json", "x-csrf-token": csrf } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  for (const cookie of response.headers.getSetCookie()) {
    const first = cookie.split(";")[0], i = first.indexOf("=");
    jar.set(first.slice(0, i), first.slice(i + 1));
  }
  if (!response.ok) { await response.arrayBuffer(); throw Error(`HTTP ${response.status}: ${url.split("?")[0]}`); }
  return response;
}
async function json(url, body) { return (await request(url, body)).json(); }
async function samples(query, validate) {
  const ms = []; let bytes = 0;
  for (let i = 0; i < 3; i++) {
    const start = performance.now(), result = await json("/admin/custom?" + new URLSearchParams(query));
    ms.push(Math.round(performance.now() - start)); bytes = Buffer.byteLength(JSON.stringify(result)); validate(result);
  }
  return { samplesMs: ms, medianMs: [...ms].sort((a, b) => a - b)[1], bytes };
}
function csvRecords(text) {
  let quoted = false, records = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '"') { if (quoted && text[i + 1] === '"') i++; else quoted = !quoted; }
    else if (text[i] === "\n" && !quoted) records++;
  }
  return records;
}
async function measureExport(mode, format, expected) {
  const destination = path.join(temporary, mode + "." + format);
  const health = []; let active = true;
  const monitoring = (async () => {
    while (active) {
      const start = performance.now();
      try { await json("/health"); health.push({ ok: true, ms: Math.round(performance.now() - start) }); }
      catch { health.push({ ok: false, ms: Math.round(performance.now() - start) }); }
      if (active) await new Promise((resolve) => setTimeout(resolve, 100));
    }
  })();
  const start = performance.now();
  try {
    const response = await request(`/admin/custom/export/${format}?year=all`);
    await pipeline(Readable.fromWeb(response.body), createWriteStream(destination));
    const ms = Math.round(performance.now() - start), bytes = (await fs.stat(destination)).size;
    active = false; await monitoring;
    let records = 0;
    if (format === "csv") records = csvRecords(await fs.readFile(destination, "utf8"));
    else {
      const workbook = new ExcelJS.stream.xlsx.WorkbookReader(destination, { worksheets: "emit", sharedStrings: "cache", hyperlinks: "ignore", styles: "ignore" });
      for await (const sheet of workbook) for await (const row of sheet) records++;
    }
    assert.equal(records - 1, expected, `Ekspor ${mode} ${format} lengkap`);
    assert.ok(health.every((h) => h.ok), "Health tetap berhasil selama ekspor");
    return { ms, bytes, dataRows: records - 1, healthChecks: health.length,
      healthMaxMs: Math.max(...health.map((h) => h.ms)) };
  } finally {
    active = false; await monitoring;
    if (path.dirname(destination) === temporary) await fs.rm(destination, { force: true });
  }
}
try {
  await fs.mkdir(temporary, { recursive: true }); await fs.mkdir(path.dirname(output), { recursive: true });
  csrf = (await json("/csrf")).token;
  await json("/auth/login", { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD });
  for (const mode of ["internal", "eksternal"]) {
    await json("/admin/mode", { mode });
    const first = await json("/admin/custom?year=all"), total = first.total;
    const result = { rows: total, columns: first.columns.length };
    result.page = await samples({ year: "all", size: "50", all: "1" }, (d) => {
      assert.equal(d.rows.length, Math.min(50, total));
      const ids = new Set(d.rows.map((r) => r.id)); assert.ok(d.cells.every((c) => ids.has(c.rowId)));
    });
    result.noMatch = await samples({ year: "all", q: "ZZZ-TIDAK-ADA-AUDIT-20261116" }, (d) => assert.equal(d.total, 0));
    const numeric = first.columns.find((c) => c.type === "number");
    if (numeric) result.numericSort = await samples({ year: "all", sort: numeric.id, dir: "desc" }, (d) => assert.equal(d.total, total));
    for (const format of ["csv", "xlsx"]) result[format] = await measureExport(mode, format, total);
    report.modes[mode] = result;
    await fs.writeFile(output, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ mode, ...result }));
  }
  const browser = await chromium.launch({ headless: true, args: ["--js-flags=--max-old-space-size=512"] });
  try {
    for (const mode of ["internal", "eksternal"]) {
      await json("/admin/mode", { mode });
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
      try {
        await context.addCookies([...jar].map(([name, value]) => ({ name, value, url: origin, httpOnly: true, sameSite: "Strict" })));
        const page = await context.newPage(), errors = [], requests = [];
        page.on("pageerror", (error) => errors.push(error.message));
        page.on("request", (req) => {
          const u = new URL(req.url());
          if (u.pathname === "/api/admin/custom") requests.push({ all: u.searchParams.get("all"), size: u.searchParams.get("size"), year: u.searchParams.get("year") });
        });
        await page.goto(origin + "/admin");
        await page.getByRole("heading", { name: "Ringkasan", exact: true }).waitFor();
        let start = performance.now();
        await page.locator("nav").getByRole("button", { name: "Tabel Kustom" }).click();
        await page.locator(".custom-table tbody tr[data-book-number]").first().waitFor({ timeout: 15000 });
        const initialMs = Math.round(performance.now() - start);
        start = performance.now();
        await page.getByRole("textbox", { name: "Cari tabel kustom", exact: true }).fill("ZZZ-TIDAK-ADA-AUDIT-20261116");
        await page.locator(".custom-scroll .empty").waitFor({ timeout: 10000 });
        const searchMs = Math.round(performance.now() - start);
        assert.deepEqual(errors, []);
        assert.ok(requests.every((r) => r.all !== "1" && r.size === "50"));
        report.modes[mode].browser = { initialMs, searchMs, errors, requests };
        console.log(JSON.stringify({ mode, browser: report.modes[mode].browser }));
      } finally { await context.close(); }
    }
  } finally { await browser.close(); }
} catch (error) { report.error = error.message; process.exitCode = 1; console.error(error.message); }
finally {
  if (csrf) await json("/auth/logout", {}).catch(() => {});
  await fs.writeFile(output, JSON.stringify(report, null, 2));
}
