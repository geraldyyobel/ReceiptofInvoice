import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
process.env.APP_ORIGIN = "http://127.0.0.1:3188";
const { app } = await import("../server/app.js");
const { db } = await import("../server/core.js");
const { sendMail, closeBrowser } = await import("../server/documents.js");
if (process.env.NODE_ENV !== "test") throw Error("Gunakan database uji.");

test("mode URL: dua tab satu login tetap terisolasi saat membaca dan menulis", async (t) => {
  const server = app.listen(3188, "127.0.0.1"); await new Promise((r) => server.once("listening", r));
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext(), origin = process.env.APP_ORIGIN;
  const token = (await (await context.request.get(origin + "/api/csrf")).json()).token;
  const auth = { "X-CSRF-Token": token }, headers = (mode) => ({ ...auth, "X-ROI-Mode": mode });
  const get = (mode, path) => context.request.get(origin + "/api/admin/" + path, { headers: headers(mode) });
  const post = (mode, path, data) => context.request.post(origin + "/api/admin/" + path, { headers: headers(mode), data });
  let internalRow, externalRow;
  try {
    assert.equal((await context.request.post(origin + "/api/auth/login", { headers: auth, data: { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD } })).status(), 200);
    const me = await (await context.request.get(origin + "/api/auth/me")).json();
    assert.equal(me.mode, null);
    await t.test("Settings global tanpa pilihan mode; header valid menentukan scope, bukan query/session", async () => {
      assert.equal((await context.request.get(origin + "/api/admin/settings")).status(), 200);
      assert.equal((await context.request.get(origin + "/api/admin/form")).status(), 409);
      for (const mode of ["internal", "eksternal"]) {
        const result = await get(mode, "form?mode=" + (mode === "internal" ? "eksternal" : "internal"));
        assert.equal(result.status(), 200); assert.equal((await result.json()).version.mode, mode);
      }
      assert.equal((await get("tidak-valid", "form")).status(), 422);
      assert.equal((await post("internal", "terms/draft", { mode: "eksternal", html: "<p>Ditolak</p>" })).status(), 409);
      const anon = await browser.newContext(); assert.equal((await anon.request.get(origin + "/api/admin/form", { headers: headers("internal") })).status(), 401); await anon.close();
      assert.equal((await context.request.post(origin + "/api/admin/custom/rows", { headers: { "X-ROI-Mode": "internal" }, data: {} })).status(), 403);
    });
    await t.test("tulis serentak mengikuti scope dan ID mode lain tidak dapat diubah", async () => {
      await context.request.post(origin + "/api/admin/mode", { headers: auth, data: { mode: "eksternal" } });
      const [a, b] = await Promise.all([post("internal", "custom/rows", { year: 2031 }), post("eksternal", "custom/rows", { year: 2031 })]);
      assert.equal(a.status(), 200); assert.equal(b.status(), 200);
      internalRow = await a.json(); externalRow = await b.json();
      assert.equal((await db.customRow.findUnique({ where: { id: internalRow.id } })).mode, "internal");
      assert.equal((await db.customRow.findUnique({ where: { id: externalRow.id } })).mode, "eksternal");
      const wrong = await context.request.patch(origin + "/api/admin/custom/rows/" + externalRow.id, { headers: headers("internal"), data: { color: "#123456" } });
      assert.equal(wrong.status(), 404);
      const correct = await context.request.patch(origin + "/api/admin/custom/rows/" + internalRow.id, { headers: headers("internal"), data: { color: "#123456" } });
      assert.equal(correct.status(), 200);
      assert.equal((await db.customRow.findUnique({ where: { id: internalRow.id } })).color, "#123456");
      assert.equal((await (await context.request.get(origin + "/api/auth/me")).json()).mode, "eksternal");
    });
    await t.test("versi form, unggahan dan notifikasi tetap dipisahkan", async () => {
      const form = (await (await get("internal", "form")).json()).version;
      assert.equal((await get("eksternal", "form/versions/" + form.id)).status(), 404);
      const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jGxkAAAAASUVORK5CYII=", "base64");
      const result = await context.request.post(origin + "/api/admin/uploads", { headers: headers("internal"), multipart: { mode: "internal", file: { name: "mode-routing.png", mimeType: "image/png", buffer: png } } });
      assert.equal(result.status(), 200); const upload = await result.json();
      assert.equal((await get("internal", "uploads/" + upload.id)).status(), 200);
      assert.equal((await get("eksternal", "uploads/" + upload.id)).status(), 404);
      for (const mode of ["internal", "eksternal"]) {
        const n = await post(mode, "notifications", { title: "Pesan khusus " + mode, message: "Uji pemisahan mode", recipients: [me.admin.id], kind: "info", priority: "normal" });
        assert.equal(n.status(), 201);
      }
      for (const mode of ["internal", "eksternal"]) {
        const notes = await (await get(mode, "notifications")).json();
        assert.ok(notes.rows.some((n) => n.notification.title === "Pesan khusus " + mode));
        assert.ok(notes.rows.every((n) => n.notification.mode === mode));
      }
    });
    await t.test("dua tab membaca dan menambah baris pada mode URL masing-masing", async () => {
      const a = await context.newPage(), b = await context.newPage(), errors = [], wrongScope = [];
      for (const [page, expected] of [[a, "internal"], [b, "eksternal"]]) {
        page.on("pageerror", (e) => errors.push(e.message));
        page.on("request", (r) => {
          if (/\/api\/admin\/(custom|notifications|form|terms|template|submissions|dashboard)(?:[/?]|$)/.test(r.url()) && r.headers()["x-roi-mode"] !== expected)
            wrongScope.push(r.url());
        });
        await page.goto(origin + "/admin/" + expected + "/tabel-kustom");
        await page.getByRole("button", { name: "＋ Baris", exact: true }).waitFor();
        assert.equal(await page.locator(".mode-badge").textContent(), expected);
      }
      const before = Object.fromEntries(await Promise.all(["internal", "eksternal"].map(async (mode) => [mode, await db.customRow.count({ where: { mode } })])));
      const resultA = a.waitForResponse((r) => r.url().endsWith("/custom/rows") && r.request().method() === "POST");
      const resultB = b.waitForResponse((r) => r.url().endsWith("/custom/rows") && r.request().method() === "POST");
      await Promise.all([a.getByRole("button", { name: "＋ Baris", exact: true }).click(), b.getByRole("button", { name: "＋ Baris", exact: true }).click()]);
      for (const [page, pending] of [[a, resultA], [b, resultB]]) {
        const response = await pending;
        if (response.status() === 409) {
          assert.match((await response.json()).error, /Data sedang diubah/);
          const retry = page.waitForResponse((r) => r.url().endsWith("/custom/rows") && r.request().method() === "POST");
          await page.getByRole("button", { name: "＋ Baris", exact: true }).click();
          assert.equal((await retry).status(), 200);
        } else assert.equal(response.status(), 200);
      }
      for (const mode of ["internal", "eksternal"]) assert.equal(await db.customRow.count({ where: { mode } }), before[mode] + 1);
      await context.request.post(origin + "/api/admin/mode", { headers: auth, data: { mode: "internal" } });
      const requests = [];
      b.on("response", (r) => { if (r.url().includes("/api/")) requests.push({ url: r.url(), status: r.status() }); });
      await b.reload();
      try { await b.getByRole("button", { name: "＋ Baris", exact: true }).waitFor(); }
      catch (e) { console.error("Mode reload diagnostics", JSON.stringify({ requests, url: b.url(), errors, text: await b.locator("body").innerText({ timeout: 2000 }).catch(() => "unresponsive") })); throw e; }
      assert.equal(await b.locator(".mode-badge").textContent(), "eksternal");
      await a.goto(origin + "/admin/internal/notifikasi"); await a.getByRole("heading", { name: "Pesan khusus internal", exact: true }).waitFor();
      await b.goto(origin + "/admin/eksternal/notifikasi"); await b.getByRole("heading", { name: "Pesan khusus eksternal", exact: true }).waitFor();
      assert.equal(await a.getByRole("heading", { name: "Pesan khusus eksternal", exact: true }).count(), 0);
      assert.equal(await b.getByRole("heading", { name: "Pesan khusus internal", exact: true }).count(), 0);
      await a.goto(origin + "/admin/settings?tab=email"); await a.getByLabel("Subjek email", { exact: true }).waitFor();
      assert.equal(await a.locator(".mode-badge").textContent(), "Global");
      assert.equal(new URL(b.url()).pathname, "/admin/eksternal/notifikasi");
      assert.deepEqual(wrongScope, []); assert.deepEqual(errors, []);
      await a.close(); await b.close();
    });
    await t.test("login langsung ke URL Eksternal tidak memerlukan perubahan mode session", async () => {
      const fresh = await browser.newContext(), page = await fresh.newPage();
      await page.goto(origin + "/admin/eksternal/form-builder");
      await page.getByLabel("Email", { exact: true }).fill(process.env.ADMIN_EMAIL);
      await page.getByLabel("Password", { exact: true }).fill(process.env.ADMIN_PASSWORD);
      await page.getByRole("button", { name: "Masuk →" }).click();
      await page.getByRole("heading", { name: "Form Builder", exact: true }).waitFor();
      assert.equal(await page.locator(".mode-badge").textContent(), "eksternal");
      assert.equal((await (await fresh.request.get(origin + "/api/auth/me")).json()).mode, null);
      await page.reload(); await page.getByRole("heading", { name: "Form Builder", exact: true }).waitFor();
      assert.equal(new URL(page.url()).pathname, "/admin/eksternal/form-builder");
      await fresh.close();
    });
    await t.test("email tes global tanpa mode tetap tercatat dan terlihat pada kedua Email Log", async () => {
      await sendMail({ recipient: "global-mode-test@example.com", req: { ip: "127.0.0.1", headers: {} }, transport: { sendMail: async () => {} } });
      for (const mode of ["internal", "eksternal"]) {
        const logs = await (await get(mode, "logs/email?q=global-mode-test%40example.com")).json();
        assert.ok(logs.rows.some((row) => row.mode === "global" && row.submissionId === null));
      }
    });
  } finally { await browser.close(); await closeBrowser(); await db.emailLog.deleteMany({ where: { recipient: "global-mode-test@example.com" } }); await new Promise((r) => server.close(r)); await db.$disconnect(); }
});
