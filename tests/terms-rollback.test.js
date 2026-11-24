import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
process.env.APP_ORIGIN = "http://127.0.0.1:3189";
const { app } = await import("../server/app.js");
const { db } = await import("../server/core.js");
if (process.env.NODE_ENV !== "test") throw Error("Gunakan database uji terpisah");
const gate = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
test("rollback ketentuan mengikuti alur preview, autosave dan publish", async (t) => {
  const server = app.listen(3189, "127.0.0.1"); await new Promise((r) => server.once("listening", r));
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext(), origin = "http://127.0.0.1:3189";
    const token = (await (await context.request.get(origin + "/api/csrf")).json()).token;
    const headers = { "X-CSRF-Token": token };
    await context.request.post(origin + "/api/auth/login", { headers, data: { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD } });
    await context.request.post(origin + "/api/admin/mode", { headers, data: { mode: "internal" } });
    await context.request.post(origin + "/api/admin/terms/version", { headers, data: { html: "<p>VERSI-A-ROLLBACK</p>", publish: false } });
    await context.request.post(origin + "/api/admin/terms/version", { headers, data: { html: "<p>VERSI-B-ROLLBACK</p>", publish: false } });
    const initial = await (await context.request.get(origin + "/api/admin/terms")).json();
    const indexA = initial.versions.findIndex((v) => v.html === "<p>VERSI-A-ROLLBACK</p>");
    const versionA = initial.versions[indexA];
    assert.ok(versionA);
    const open = async () => {
      await context.request.put(origin + "/api/admin/terms/draft", { headers, data: { html: "<p>VERSI-B-ROLLBACK</p>" } });
      const page = await context.newPage(); await page.goto(origin + "/admin");
      await page.locator(".sidebar nav").getByRole("link", { name: /Editor Ketentuan/ }).click();
      await page.waitForFunction(() => window.tinymce?.activeEditor?.initialized);
      return page;
    };
    const rollback = (page) => page.locator(".version-list").getByRole("button", { name: "Rollback ke draft", exact: true }).nth(indexA);
    await t.test("rollback dari pratinjau menampilkan isi versi yang dipulihkan", async () => {
      const page = await open();
      try {
        await page.getByRole("button", { name: "Pratinjau tampilan vendor", exact: true }).click();
        await page.locator(".terms-preview").getByText("VERSI-B-ROLLBACK", { exact: true }).waitFor();
        page.once("dialog", (dialog) => dialog.accept()); await rollback(page).click();
        await page.getByText("Versi dipulihkan ke draft. Publish untuk menayangkan.", { exact: true }).waitFor();
        if (!await page.locator(".terms-preview").count()) await page.waitForFunction(() => window.tinymce?.activeEditor?.initialized);
        const shown = await page.evaluate(() => document.querySelector(".terms-preview")?.textContent || window.tinymce?.activeEditor?.getBody()?.textContent || "");
        assert.ok(shown.includes("VERSI-A-ROLLBACK"), "Editor/pratinjau harus mengikuti draft hasil rollback");
        assert.ok(!shown.includes("VERSI-B-ROLLBACK"));
      } finally { await page.close(); }
    });
    await t.test("autosave lama tidak menimpa isi yang baru di-rollback", async () => {
      const page = await open(), started = gate(), release = gate();
      try {
        await page.route("**/api/admin/terms/draft", async (route) => { started.resolve(); await release.promise; await route.continue(); });
        await page.evaluate(() => { const e = window.tinymce.activeEditor; e.setContent("<p>AUTOSAVE-LAMA</p>"); e.fire("change"); });
        await started.promise;
        page.once("dialog", (dialog) => dialog.accept()); await rollback(page).click();
        await new Promise((r) => setTimeout(r, 250));
        const draftResponse = page.waitForResponse((r) => r.url().endsWith("/api/admin/terms/draft") && r.request().method() === "PUT");
        release.resolve(); await (await draftResponse).finished();
        await page.getByText("Versi dipulihkan ke draft. Publish untuk menayangkan.", { exact: true }).waitFor();
        const result = await (await context.request.get(origin + "/api/admin/terms")).json();
        assert.equal(result.term.draft, versionA.html);
        assert.equal(result.term.publishedId, initial.term.publishedId, "Rollback draft tidak boleh mempublikasikan versi sendiri");
      } finally { release.resolve(); await page.close(); }
    });
    await t.test("rollback tidak dapat dijalankan di tengah publish yang belum selesai", async () => {
      const page = await open(), started = gate(), release = gate();
      try {
        await page.route("**/api/admin/terms/version", async (route) => { started.resolve(); await release.promise; await route.continue(); });
        await page.getByRole("button", { name: "Publish ketentuan", exact: true }).click(); await started.promise;
        assert.equal(await rollback(page).isDisabled(), true);
      } finally {
        release.resolve();
        await page.getByText("Ketentuan dipublikasikan ke halaman vendor.", { exact: true }).waitFor();
        await page.close();
      }
    });
  } finally { await browser.close(); await new Promise((r) => server.close(r)); await db.$disconnect(); }
});
