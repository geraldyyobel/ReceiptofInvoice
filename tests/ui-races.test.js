import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
process.env.APP_ORIGIN = "http://127.0.0.1:3194";
const { app } = await import("../server/app.js");
const { db } = await import("../server/core.js");
if (process.env.NODE_ENV !== "test") throw Error("Gunakan database uji terpisah");

const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
const settleUI = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const rows = (reference) => ({ rows: [{ id: reference, bookYear: 2026, bookNumber: 1, reference, vendor: "Vendor Uji", email: "vendor@example.test", submittedAt: "2026-11-17T00:00:00Z", status: "diterima" }], total: 1, page: 1, size: 20, years: [{ year: 2026, count: 1 }], currentYear: 2026 });

test("respons lambat tidak boleh menimpa filter atau tab terbaru", async (t) => {
  const server = app.listen(3194, "127.0.0.1"); await new Promise((r) => server.once("listening", r));
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext(), origin = "http://127.0.0.1:3194";
    const token = (await (await context.request.get(origin + "/api/csrf")).json()).token;
    await context.request.post(origin + "/api/auth/login", { headers: { "X-CSRF-Token": token }, data: { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD } });
    await context.request.post(origin + "/api/admin/mode", { headers: { "X-CSRF-Token": token }, data: { mode: "eksternal" } });
    for (const failOld of [false, true]) await t.test(failOld ? "error pencarian lama tidak muncul pada filter baru" : "hasil pencarian terbaru bertahan ketika respons lama datang terakhir", async () => {
      const page = await context.newPage(), held = deferred(), release = deferred(), delivered = deferred();
      try {
        await page.route("**/api/admin/submissions?**", async (route) => {
          const q = new URL(route.request().url()).searchParams.get("q");
          if (q === "lama") { held.resolve(); await release.promise;
            await route.fulfill({ status: failOld ? 503 : 200, json: failOld ? { error: "ERROR_FILTER_LAMA" } : rows("HASIL-LAMA") }); delivered.resolve(); }
          else await route.fulfill({ json: rows(q === "baru" ? "HASIL-BARU" : "HASIL-AWAL") });
        });
        await page.goto(origin + "/admin");
        await page.locator(".sidebar nav").getByRole("button", { name: /Data Form/ }).click();
        await page.getByText("HASIL-AWAL", { exact: true }).waitFor();
        await page.getByLabel("Cari data", { exact: true }).fill("lama"); await held.promise;
        await page.getByLabel("Cari data", { exact: true }).fill("baru");
        await page.getByText("HASIL-BARU", { exact: true }).waitFor();
        const response = page.waitForResponse((r) => new URL(r.url()).searchParams.get("q") === "lama");
        release.resolve(); await delivered.promise; await (await response).finished(); await settleUI(page);
        assert.equal(await page.locator(".reference-cell").innerText(), "HASIL-BARU");
        assert.equal(await page.getByText("ERROR_FILTER_LAMA", { exact: true }).count(), 0);
      } finally { release.resolve(); await page.close(); }
    });
    await t.test("respons Activity Log lama tidak masuk ke tab Email Log", async () => {
      const page = await context.newPage(), held = deferred(), release = deferred(), delivered = deferred();
      try {
        await page.route("**/api/admin/logs/**", async (route) => {
          if (new URL(route.request().url()).pathname.endsWith("/activity")) {
            held.resolve(); await release.promise;
            await route.fulfill({ json: { rows: [{ id: "old", actor: "Aktor lama", action: "OLD_LOG", createdAt: "2026-11-17T00:00:00Z", ip: "test" }], total: 1, page: 1, size: 20 } }); delivered.resolve();
          } else await route.fulfill({ json: { rows: [{ id: "new", recipient: "new@example.test", status: "terkirim", createdAt: "2026-11-17T00:00:00Z" }], total: 1, page: 1, size: 20 } });
        });
        await page.goto(origin + "/admin");
        await page.locator(".sidebar nav").getByRole("button", { name: /Logs & Backup/ }).click(); await held.promise;
        await page.getByRole("button", { name: "Email Log", exact: true }).click();
        await page.getByText("new@example.test", { exact: true }).waitFor();
        const response = page.waitForResponse((r) => new URL(r.url()).pathname.endsWith("/logs/activity"));
        release.resolve(); await delivered.promise; await (await response).finished(); await settleUI(page);
        assert.equal(await page.getByText("new@example.test", { exact: true }).count(), 1);
      } finally { release.resolve(); await page.close(); }
    });
    await t.test("daftar backup dimuat ulang setelah Backup sekarang selesai", async () => {
      const page = await context.newPage(); let created = false;
      try {
        await page.route("**/api/admin/backups", async (route) => {
          if (route.request().method() === "POST") { created = true; await route.fulfill({ json: { ok: true } }); }
          else await route.fulfill({ json: created ? [{ id: "backup-uji", filename: "arsip-baru.zip.enc", status: "selesai", size: 1000, createdAt: "2026-11-17T00:00:00Z" }] : [] });
        });
        await page.goto(origin + "/admin");
        await page.locator(".sidebar nav").getByRole("button", { name: /Logs & Backup/ }).click();
        await page.getByRole("button", { name: "Backup & Restore", exact: true }).click();
        await page.getByRole("button", { name: "＋ Backup sekarang", exact: true }).click();
        await page.getByText("arsip-baru.zip.enc", { exact: true }).waitFor();
        assert.equal(created, true);
      } finally { await page.close(); }
    });
  } finally { await browser.close(); await new Promise((r) => server.close(r)); await db.$disconnect(); }
});
