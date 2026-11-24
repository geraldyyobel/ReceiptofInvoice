import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
process.env.APP_ORIGIN = "http://127.0.0.1:3191";
const { app } = await import("../server/app.js");
const { db } = await import("../server/core.js");
if (process.env.NODE_ENV !== "test") throw Error("Gunakan database uji terpisah");
test("font editor, simpan, pratinjau dan publik konsisten dalam px", async () => {
  const server = app.listen(3191, "127.0.0.1"); await new Promise((r) => server.once("listening", r));
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext(), page = await context.newPage(), origin = "http://127.0.0.1:3191", errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const token = (await (await context.request.get(origin + "/api/csrf")).json()).token;
    await context.request.post(origin + "/api/auth/login", { headers: { "X-CSRF-Token": token }, data: { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD } });
    await context.request.post(origin + "/api/admin/mode", { headers: { "X-CSRF-Token": token }, data: { mode: "internal" } });
    const fixture = '<h3 class="test-heading">Judul ketentuan</h3><p class="edited-block"><span style="font-size:17.55px"><strong>Ukuran uji</strong></span></p><p class="legacy"><span style="font-size:14pt">Format lama</span></p>';
    await context.request.put(origin + "/api/admin/terms/draft", { headers: { "X-CSRF-Token": token }, data: { html: fixture } });
    await page.goto(origin + "/admin");
    await page.locator(".sidebar nav").getByRole("link", { name: /Editor Ketentuan/ }).click();
    await page.waitForFunction(() => window.tinymce?.activeEditor?.initialized);
    const editorSize = (selector) => page.evaluate((selector) => {
      const doc = window.tinymce.activeEditor.getDoc(), walker = doc.createTreeWalker(doc.querySelector(selector), 4);
      let text; while ((text = walker.nextNode())) if (text.textContent.trim()) return doc.defaultView.getComputedStyle(text.parentElement).fontSize;
    }, selector);
    assert.equal(await editorSize(".test-heading"), "17px");
    assert.equal(await editorSize(".edited-block"), "17.55px");
    assert.ok(Math.abs(parseFloat(await editorSize(".legacy")) - 18.6667) < .01);
    const input = page.locator('[data-mce-name="fontsizeinput"] input');
    for (const size of [18, 14]) {
      await page.evaluate(() => { const e = window.tinymce.activeEditor; e.selection.select(e.getBody().querySelector(".edited-block"), true); e.nodeChanged(); });
      await input.fill(String(size)); await input.press("Enter");
      assert.equal(await editorSize(".edited-block"), size + "px");
    }
    await page.evaluate(() => window.tinymce.activeEditor.undoManager.undo());
    assert.equal(await editorSize(".edited-block"), "18px");
    await page.evaluate(() => window.tinymce.activeEditor.undoManager.redo());
    assert.equal(await editorSize(".edited-block"), "14px");
    await page.getByRole("button", { name: "Simpan versi", exact: true }).click();
    await page.getByText("Versi ketentuan disimpan.", { exact: true }).waitFor();
    await page.reload(); await page.locator(".sidebar nav").getByRole("link", { name: /Editor Ketentuan/ }).click();
    await page.waitForFunction(() => window.tinymce?.activeEditor?.initialized);
    assert.equal(await editorSize(".edited-block"), "14px");
    await page.getByRole("button", { name: "Publish ketentuan", exact: true }).click();
    await page.getByText("Ketentuan dipublikasikan ke halaman vendor.", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Pratinjau tampilan vendor", exact: true }).click();
    await page.locator(".terms-preview .edited-block").waitFor();
    assert.equal(await page.locator(".terms-preview .edited-block").evaluate((el) => getComputedStyle(el.querySelector("span") || el).fontSize), "14px");
    const publicPage = await context.newPage(); await publicPage.goto(origin + "/internal");
    await publicPage.locator(".rich .edited-block").waitFor();
    for (const width of [1440, 390]) {
      await publicPage.setViewportSize({ width, height: 900 });
      assert.equal(await publicPage.locator(".rich .edited-block").evaluate((el) => getComputedStyle(el.querySelector("span") || el).fontSize), "14px");
      assert.equal(await publicPage.locator(".rich .test-heading").evaluate((el) => getComputedStyle(el).fontSize), "17px");
    }
    const published = (await (await context.request.get(origin + "/api/admin/terms")).json()).term.draft;
    assert.match(published, /14px/); assert.match(published, /14pt/);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await new Promise((r) => server.close(r)); await db.$disconnect(); }
});
