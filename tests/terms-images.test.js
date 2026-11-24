import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
process.env.APP_ORIGIN = "http://127.0.0.1:3190";
const { app } = await import("../server/app.js");
const { db, cleanHtml } = await import("../server/core.js");
if (process.env.NODE_ENV !== "test") throw Error("Gunakan database uji terpisah");
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jGxkAAAAASUVORK5CYII=", "base64");
const gate = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
test("gambar ketentuan bertahan setelah unggah, draft dan publikasi", async (t) => {
  const server = app.listen(3190, "127.0.0.1"); await new Promise((r) => server.once("listening", r));
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext(), origin = "http://127.0.0.1:3190", page = await context.newPage();
    const token = (await (await context.request.get(origin + "/api/csrf")).json()).token;
    await context.request.post(origin + "/api/auth/login", { headers: { "X-CSRF-Token": token }, data: { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD } });
    await context.request.post(origin + "/api/admin/mode", { headers: { "X-CSRF-Token": token }, data: { mode: "internal" } });
    async function openEditor() {
      await page.goto(origin + "/admin");
      await page.locator(".sidebar nav").getByRole("link", { name: /Editor Ketentuan/ }).click();
      try { await page.waitForFunction(() => window.tinymce?.activeEditor?.initialized); }
      catch (e) {
        console.error("Terms editor state:", await page.evaluate(() => ({
          heading: document.querySelector(".admin-content h1")?.textContent,
          errors: [...document.querySelectorAll(".notice.error")].map((n) => n.textContent),
          scriptLoaded: !!window.tinymce,
          activeEditor: window.tinymce?.activeEditor?.id,
          initialized: window.tinymce?.activeEditor?.initialized,
          containers: document.querySelectorAll(".tox-tinymce").length,
        })));
        throw e;
      }
    }
    const editorImage = () => page.frameLocator(".tox-edit-area iframe").locator('img[alt="gambar-uji.png"]');
    let uploaded;
    await t.test("pilih gambar dari komputer lalu simpan versi, muat ulang dan publish", async () => {
      await openEditor();
      await page.evaluate(() => window.tinymce.activeEditor.execCommand("mceImage"));
      const dialog = page.getByRole("dialog");
      const chooser = page.waitForEvent("filechooser");
      await dialog.locator(".tox-browse-url").click();
      const upload = page.waitForResponse((r) => r.url().endsWith("/api/admin/uploads") && r.request().method() === "POST");
      await (await chooser).setFiles({ name: "gambar-uji.png", mimeType: "image/png", buffer: png });
      uploaded = await (await upload).json();
      await dialog.locator("input").first().waitFor();
      await page.waitForFunction(() => document.querySelector('.tox-dialog input')?.value.includes("uploads/"));
      await dialog.locator(".tox-dialog__footer-end button").last().click();
      await editorImage().waitFor();
      await page.getByRole("button", { name: "Simpan versi", exact: true }).click();
      await page.getByText("Versi ketentuan disimpan.", { exact: true }).waitFor();
      const draft = (await (await context.request.get(origin + "/api/admin/terms")).json()).term.draft;
      assert.ok(draft.includes(uploaded.location), "Alamat gambar unggahan harus tetap tersimpan pada draft");
      await openEditor(); await editorImage().waitFor();
      assert.equal(await editorImage().evaluate((img) => img.complete && img.naturalWidth > 0), true);
      await page.getByRole("button", { name: "Publish ketentuan", exact: true }).click();
      await page.getByText("Ketentuan dipublikasikan ke halaman vendor.", { exact: true }).waitFor();
      await page.getByRole("button", { name: "Pratinjau tampilan vendor", exact: true }).click();
      await page.locator('.terms-preview img[alt="gambar-uji.png"]').waitFor();
      const vendor = await browser.newPage(); await vendor.goto(origin + "/internal");
      const image = vendor.locator('.rich img[alt="gambar-uji.png"]'); await image.waitFor();
      assert.equal(await image.evaluate((img) => img.complete && img.naturalWidth > 0), true);
      assert.equal((await vendor.request.get(origin + uploaded.location)).status(), 200);
      await vendor.close();
    });
    await t.test("publish menunggu unggahan gambar paste, termasuk autosave yang tertunda", async () => {
      await openEditor();
      const started = gate(), release = gate(); let savedWhileUploading = false;
      const observer = (request) => { if (request.url().endsWith("/api/admin/terms/version")) savedWhileUploading = true; };
      const before = (await (await context.request.get(origin + "/api/admin/terms")).json()).term.publishedId;
      await page.route("**/api/admin/uploads", async (route) => { started.resolve(); await release.promise; await route.continue(); });
      try {
        await page.evaluate((src) => window.tinymce.activeEditor.insertContent(`<p><img src="${src}" alt="paste-uji"></p>`), "data:image/png;base64," + png.toString("base64"));
        await started.promise;
        page.on("request", observer);
        await page.getByRole("button", { name: "Publish ketentuan", exact: true }).click();
        await new Promise((r) => setTimeout(r, 1800));
        assert.equal(savedWhileUploading, false, "Jangan publish HTML saat gambar masih berupa blob/data sementara");
        assert.equal((await (await context.request.get(origin + "/api/admin/terms")).json()).term.publishedId, before);
      } finally { page.off("request", observer); release.resolve(); }
      await page.getByText("Ketentuan dipublikasikan ke halaman vendor.", { exact: true }).waitFor();
      const d = (await (await context.request.get(origin + "/api/admin/terms")).json()).term;
      assert.ok(d.draft.includes('alt="paste-uji"')); assert.ok(!/src="(?:data:|blob:)/i.test(d.draft));
      await page.unroute("**/api/admin/uploads");
    });
    await t.test("API menolak gambar sementara tanpa mengganti draft atau versi", async () => {
      const before = (await (await context.request.get(origin + "/api/admin/terms")).json()).term;
      for (const src of ["blob:http://localhost/temporary", "data:image/png;base64," + png.toString("base64")]) {
        for (const [method, url, body] of [["put", "/draft", {}], ["post", "/version", { publish: true }]]) {
          const r = await context.request[method](origin + "/api/admin/terms" + url, { headers: { "X-CSRF-Token": token }, data: { ...body, html: `<p>Belum siap<img src="${src}"></p>` } });
          assert.equal(r.status(), 422);
        }
      }
      const after = (await (await context.request.get(origin + "/api/admin/terms")).json()).term;
      assert.equal(after.draft, before.draft); assert.equal(after.publishedId, before.publishedId);
      assert.ok(!cleanHtml('<img src="javascript:alert(1)" onerror="alert(1)"><script>alert(1)</script>').includes("<img"));
    });
    await t.test("unggahan gagal tidak mempublikasikan versi tanpa gambar", async () => {
      await openEditor();
      const before = (await (await context.request.get(origin + "/api/admin/terms")).json()).term;
      await page.route("**/api/admin/uploads", (route) => route.fulfill({ status: 422, json: { error: "Gambar uji ditolak" } }));
      try {
        await page.evaluate((src) => window.tinymce.activeEditor.insertContent(`<p><img src="${src}" alt="unggahan-gagal"></p>`), "data:image/png;base64," + png.toString("base64"));
        await page.getByRole("button", { name: "Publish ketentuan", exact: true }).click();
        await page.getByText("Belum tersimpan", { exact: true }).waitFor();
        const after = (await (await context.request.get(origin + "/api/admin/terms")).json()).term;
        assert.equal(after.publishedId, before.publishedId); assert.equal(after.draft, before.draft);
      } finally { await page.unroute("**/api/admin/uploads"); }
    });
    await t.test("gambar tersimpan dapat disisipkan ulang tanpa unggah baru, hanya mode aktif", async () => {
      await openEditor();
      const before = await db.upload.count({ where: { mode: "internal", public: true } });
      await page.evaluate(() => { const e = window.tinymce.activeEditor; e.selection.select(e.getBody(), true); e.selection.collapse(false); });
      await page.getByRole("button", { name: "Sisipkan gambar tersimpan", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Gambar tersimpan", exact: true });
      await dialog.getByRole("button", { name: /gambar-uji.png/ }).click();
      await page.waitForFunction(() => window.tinymce.activeEditor.getBody().querySelectorAll('img[alt="gambar-uji.png"]').length === 2);
      await page.getByRole("button", { name: "Publish ketentuan", exact: true }).click();
      await page.getByText("Ketentuan dipublikasikan ke halaman vendor.", { exact: true }).waitFor();
      assert.equal(await db.upload.count({ where: { mode: "internal", public: true } }), before);
      const list = await context.request.get(origin + "/api/admin/images?size=1");
      assert.equal(list.status(), 200); assert.equal((await list.json()).rows.length, 1);
      assert.equal((await (await browser.newContext()).request.get(origin + "/api/admin/images")).status(), 401);
      await db.upload.createMany({ data: [
        { mode: "internal", filename: "private-test.png", originalName: "PRIVATE", mime: "image/png", size: 1, public: false },
        { mode: "eksternal", filename: "other-mode-test.png", originalName: "OTHER_MODE", mime: "image/png", size: 1, public: true },
      ] });
      const internal = await (await context.request.get(origin + "/api/admin/images")).json();
      assert.ok(!internal.rows.some((r) => ["PRIVATE", "OTHER_MODE"].includes(r.name)));
      await context.request.post(origin + "/api/admin/mode", { headers: { "X-CSRF-Token": token }, data: { mode: "eksternal" } });
      const external = await (await context.request.get(origin + "/api/admin/images")).json();
      assert.ok(external.rows.some((r) => r.name === "OTHER_MODE"));
      assert.ok(!external.rows.some((r) => r.name === "gambar-uji.png"));
      const externalBefore = (await (await context.request.get(origin + "/api/admin/terms")).json()).term;
      const oldMode = await context.request.put(origin + "/api/admin/terms/draft", { headers: { "X-CSRF-Token": token }, data: { mode: "internal", html: "<p>Respons editor mode lama</p>" } });
      assert.equal(oldMode.status(), 409);
      const wrongUpload = await context.request.post(origin + "/api/admin/uploads", { headers: { "X-CSRF-Token": token }, multipart: { mode: "internal", file: { name: "wrong-mode.png", mimeType: "image/png", buffer: png } } });
      assert.equal(wrongUpload.status(), 409);
      assert.equal((await (await context.request.get(origin + "/api/admin/terms")).json()).term.draft, externalBefore.draft);
    });
    await t.test("alamat unggahan relatif lama dinormalisasi tanpa membuka URL gambar berbahaya", () => {
      for (const prefix of ["", "./", "../", "../../"]) {
        const content = cleanHtml(`<img src="${prefix}${uploaded.location.slice(1)}" onerror="alert(1)">`);
        assert.ok(content.includes(`src="${uploaded.location}"`)); assert.ok(!content.includes("onerror"));
      }
      for (const src of ["../private/secret.png", "//evil.test/a.png", "https://evil.test" + uploaded.location])
        assert.ok(!cleanHtml(`<img src="${src}">`).includes("<img"));
    });
  } finally { await browser.close(); await new Promise((r) => server.close(r)); await db.$disconnect(); }
});
