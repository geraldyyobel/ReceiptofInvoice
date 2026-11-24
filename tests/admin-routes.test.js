import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import bcrypt from "bcryptjs";
process.env.APP_ORIGIN = "http://127.0.0.1:3198";
const { app } = await import("../server/app.js");
const { db } = await import("../server/core.js");
const { closeBrowser } = await import("../server/documents.js");
if (process.env.NODE_ENV !== "test") throw Error("Gunakan database uji.");

test("URL admin: tautan langsung, history, tab, filter dan otorisasi", async (t) => {
  const server = app.listen(3198, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage(), origin = process.env.APP_ORIGIN, errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const heading = (name) => page.locator(".admin-content > .page-heading").getByRole("heading", { name, exact: true }).waitFor();
  const nav = (name) => page.locator(".sidebar nav").getByRole("link", { name, exact: false });
  const path = () => new URL(page.url()).pathname;
  const tab = () => new URL(page.url()).searchParams.get("tab");
  try {
    await t.test("tautan tujuan tetap terbuka setelah login dan memilih mode", async () => {
      await page.goto(origin + "/admin/settings?tab=email");
      await page.getByLabel("Email", { exact: true }).fill(process.env.ADMIN_EMAIL);
      await page.getByLabel("Password", { exact: true }).fill(process.env.ADMIN_PASSWORD);
      await page.getByRole("button", { name: "Masuk →" }).click();
      await heading("Settings");
      await page.getByLabel("Subjek email", { exact: true }).waitFor();
      assert.equal(path(), "/admin/settings"); assert.equal(tab(), "email");
    });
    await t.test("seluruh menu punya href; membuka langsung dan refresh mempertahankan halaman", async () => {
      for (const [slug, name] of [
        ["ringkasan", "Ringkasan"], ["notifikasi", "Notifikasi"], ["data-form", "Data Form"],
        ["tabel-kustom", "Tabel Kustom"], ["ketentuan", "Editor Ketentuan"], ["form-builder", "Form Builder"],
        ["template", "Template Dokumen"], ["logs-backup", "Logs & Backup"], ["settings", "Settings"],
      ]) {
        assert.equal(await nav(name).getAttribute("href"), (slug === "settings" ? "/admin/settings" : "/admin/internal/" + slug));
        await nav(name).click(); await heading(name);
        assert.equal(path(), (slug === "settings" ? "/admin/settings" : "/admin/internal/" + slug));
        assert.equal(await nav(name).getAttribute("aria-current"), "page");
        await page.reload(); await heading(name);
      }
      const another = await context.newPage();
      await another.goto(origin + "/admin/internal/form-builder");
      await another.getByRole("heading", { name: "Form Builder", exact: true }).waitFor();
      await another.close();
    });
    await t.test("Kembali/Maju mengembalikan menu dan tab tanpa reload", async () => {
      await nav("Ringkasan").click(); await heading("Ringkasan");
      await nav("Settings").click(); await heading("Settings");
      await page.getByRole("button", { name: "Email / SMTP", exact: true }).click();
      await page.getByLabel("Subjek email", { exact: true }).waitFor(); assert.equal(tab(), "email");
      await page.getByRole("button", { name: "Dokumen", exact: true }).click();
      await page.getByLabel("Kode form", { exact: true }).waitFor(); assert.equal(tab(), "dokumen");
      await page.goBack(); await page.getByLabel("Subjek email", { exact: true }).waitFor(); assert.equal(tab(), "email");
      await page.goForward(); await page.getByLabel("Kode form", { exact: true }).waitFor();
      await page.reload(); await page.getByLabel("Kode form", { exact: true }).waitFor(); assert.equal(tab(), "dokumen");
      await nav("Data Form").click(); await heading("Data Form");
      await nav("Notifikasi").click(); await heading("Notifikasi");
      await page.goBack(); await heading("Data Form");
      await page.goForward(); await heading("Notifikasi");
      await page.getByRole("button", { name: "Terkirim / terjadwal", exact: true }).click();
      assert.equal(tab(), "sent");
      await page.reload(); await page.getByText("Belum ada pesan terkirim atau terjadwal.", { exact: true }).waitFor();
      await page.getByRole("button", { name: "Kotak masuk", exact: true }).click();
      await page.goBack(); assert.equal(tab(), "sent");
    });
    await t.test("filter Data Form dan tautan dari Ringkasan bertahan setelah refresh", async () => {
      await page.goto(origin + "/admin/internal/data-form?year=all&page=2&q=vendor-uji&followup=legality");
      await heading("Data Form");
      assert.equal(await page.getByLabel("Cari data", { exact: true }).inputValue(), "vendor-uji");
      assert.equal(await page.getByLabel("Tahun buku data form").inputValue(), "all");
      assert.equal(await page.getByLabel("Filter tindak lanjut").inputValue(), "legality");
      await page.getByLabel("Cari data", { exact: true }).fill("baru");
      assert.equal(new URL(page.url()).searchParams.get("q"), "baru");
      assert.equal(new URL(page.url()).searchParams.get("page"), "1");
      await page.reload(); await page.getByLabel("Cari data", { exact: true }).waitFor();
      assert.equal(await page.getByLabel("Cari data", { exact: true }).inputValue(), "baru");
      await page.goto(origin + "/admin/internal/ringkasan"); await heading("Ringkasan");
      await page.getByRole("button", { name: "Buka Email Log →", exact: true }).click();
      await heading("Logs & Backup"); assert.equal(tab(), "email");
      await page.reload(); await heading("Logs & Backup");
      assert.equal(await page.getByRole("button", { name: "Email Log", exact: true }).getAttribute("class"), "active");
      await page.getByRole("button", { name: "Activity Log", exact: true }).click();
      await page.goBack(); assert.equal(tab(), "email");
    });
    await t.test("alias lama, callback OAuth dan URL tidak valid ditangani", async () => {
      await page.goto(origin + "/admin"); await heading("Ringkasan"); assert.equal(path(), "/admin/internal/ringkasan");
      await page.goto(origin + "/admin?mail_oauth=denied"); await heading("Settings");
      await page.getByText("Fitur login Google/Outlook telah dihapus. Gunakan konfigurasi SMTP.", { exact: true }).waitFor();
      assert.equal(path(), "/admin/settings"); assert.equal(tab(), "email");
      assert.equal(new URL(page.url()).searchParams.has("mail_oauth"), false);
      await page.reload(); await page.getByLabel("Subjek email", { exact: true }).waitFor();
      await page.goto(origin + "/admin/settings?tab=constructor");
      await page.getByLabel("Nama aplikasi", { exact: true }).waitFor();
      await page.goto(origin + "/admin/tidak-ada"); await heading("Halaman tidak ditemukan");
      await page.getByRole("link", { name: "Buka Ringkasan", exact: true }).click(); await heading("Ringkasan");
      await page.goto(origin + "/admin/internal/notifikasi/"); await heading("Notifikasi"); assert.equal(path(), "/admin/internal/notifikasi");
    });
    await t.test("popup tidak mengubah URL dan navigasi mobile menutup menu", async () => {
      const before = page.url();
      await page.locator(".notification-bell").click();
      await page.getByRole("dialog", { name: "Notifikasi terbaru" }).waitFor();
      assert.equal(page.url(), before);
      await page.keyboard.press("Escape");
      await page.setViewportSize({ width: 390, height: 844 });
      await page.getByRole("button", { name: "Buka menu", exact: true }).click();
      await nav("Data Form").click(); await heading("Data Form");
      assert.equal(await page.locator(".sidebar.open").count(), 0);
      assert.equal(path(), "/admin/internal/data-form");
      await page.getByRole("button", { name: "⇄ Pindah mode", exact: true }).click();
      await heading("Ringkasan"); assert.equal(path(), "/admin/eksternal/ringkasan");
      await page.locator(".mode-badge").getByText("eksternal", { exact: true }).waitFor();
    });
    await t.test("tautan langsung tidak melewati role Settings", async () => {
      await db.admin.upsert({ where: { email: "routes-basic@bcupt.id" }, update: {}, create: {
        email: "routes-basic@bcupt.id", name: "Admin Routing", role: "admin", password: await bcrypt.hash("RoutingUji!2026", 4),
      } });
      const basic = await browser.newContext();
      const token = (await (await basic.request.get(origin + "/api/csrf")).json()).token;
      const headers = { "X-CSRF-Token": token };
      assert.equal((await basic.request.post(origin + "/api/auth/login", { headers, data: { email: "routes-basic@bcupt.id", password: "RoutingUji!2026" } })).status(), 200);
      await basic.request.post(origin + "/api/admin/mode", { headers, data: { mode: "internal" } });
      const restricted = await basic.newPage(); await restricted.goto(origin + "/admin/settings?tab=email");
      await restricted.getByText("Settings hanya dapat dibuka Super Admin.", { exact: true }).waitFor();
      assert.equal(await restricted.locator(".sidebar nav").getByRole("link", { name: /Settings/ }).count(), 0);
      assert.equal((await basic.request.get(origin + "/api/admin/settings")).status(), 403);
      await basic.close();
      assert.deepEqual(errors, []);
    });
    await t.test("akses menu per role dan per akun berlaku pada sidebar, URL dan API kedua mode", async () => {
      const account = await db.admin.findUniqueOrThrow({ where: { email: "routes-basic@bcupt.id" } });
      const basic = await browser.newContext();
      const base = origin + "/api/admin/settings/menu-access";
      const superHeaders = { "X-CSRF-Token": (await (await context.request.get(origin + "/api/csrf")).json()).token };
      const ordinaryHeaders = { "X-CSRF-Token": (await (await basic.request.get(origin + "/api/csrf")).json()).token };
      const paths = await (await context.request.get(base)).json();
      const changeRole = (role, menus) => context.request.put(base + "/roles/" + role, { headers: superHeaders, data: { menus } });
      const changeAccount = (overrides) => context.request.put(base + "/accounts/" + account.id, { headers: superHeaders, data: { overrides } });
      const read = (resource, mode = "internal") => basic.request.get(origin + "/api/admin/" + resource, { headers: { "X-ROI-Mode": mode } });
      try {
        assert.equal((await basic.request.post(origin + "/api/auth/login", {
          headers: ordinaryHeaders, data: { email: account.email, password: "RoutingUji!2026" },
        })).status(), 200);
        assert.equal((await read("submissions")).status(), 200);
        assert.equal((await basic.request.get(base)).status(), 403);
        assert.equal((await basic.request.put(base + "/roles/admin", {
          headers: ordinaryHeaders, data: { menus: ["data"] },
        })).status(), 403);
        assert.equal((await changeRole("admin", ["settings"])).status(), 422);
        assert.equal((await changeAccount({ settings: true })).status(), 422);

        await page.setViewportSize({ width: 1440, height: 1000 });
        await page.goto(origin + "/admin/settings?tab=akses-menu");
        await page.getByRole("button", { name: "Simpan akses menu" }).waitFor();
        for (const menu of ["Notifikasi", "Data Form", "Tabel Kustom", "Form Builder", "Template Dokumen", "Logs & Backup"])
          await page.getByRole("checkbox", { name: menu, exact: true }).uncheck();
        await page.getByRole("button", { name: "Simpan akses menu" }).click();
        await page.getByText("Aturan akses menu disimpan.", { exact: true }).waitFor();
        for (const mode of ["internal", "eksternal"]) {
          assert.equal((await read("terms", mode)).status(), 200);
          for (const path of ["submissions", "submissions/export/csv", "uploads/missing", "custom", "form", "template", "logs/email", "notifications/unread"])
            assert.equal((await read(path, mode)).status(), 403, path);
        }
        const deniedWrite = await basic.request.post(origin + "/api/admin/custom/rows", {
          headers: { ...ordinaryHeaders, "X-ROI-Mode": "eksternal" }, data: { year: 2026 },
        });
        assert.equal(deniedWrite.status(), 403);
        assert.equal((await read("SUBMISSIONS")).status(), 403);
        const restricted = await basic.newPage();
        await restricted.goto(origin + "/admin/internal/ringkasan");
        await restricted.getByRole("heading", { name: "Top 10 vendor" }).waitFor();
        assert.equal(await restricted.locator(".sidebar nav a").count(), 2);
        assert.equal(await restricted.locator(".notification-bell").count(), 0);
        assert.equal(await restricted.getByRole("button", { name: /Buka Email Log/ }).count(), 0);
        assert.equal(await restricted.getByRole("heading", { name: "Perlu tindak lanjut" }).count(), 0);
        await restricted.goto(origin + "/admin/eksternal/data-form");
        await restricted.getByText("Anda tidak memiliki akses ke menu ini.", { exact: true }).waitFor();

        await page.getByRole("button", { name: "Berdasarkan akun" }).click();
        await page.getByLabel("Akun yang diatur").selectOption(account.id);
        await page.getByRole("combobox", { name: "Data Form", exact: true }).selectOption("allow");
        await page.getByRole("combobox", { name: "Editor Ketentuan", exact: true }).selectOption("deny");
        await page.getByRole("button", { name: "Simpan akses menu" }).click();
        await page.getByText("Aturan akses menu disimpan.", { exact: true }).waitFor();
        await restricted.evaluate(() => window.dispatchEvent(new Event("focus")));
        await restricted.getByRole("heading", { name: "Data Form", exact: true }).waitFor();
        assert.equal((await read("submissions", "eksternal")).status(), 200);
        assert.equal((await read("terms")).status(), 403);
        const me = await (await basic.request.get(origin + "/api/auth/me")).json();
        assert.deepEqual(me.admin.menus, ["dashboard", "data"]);

        assert.equal((await changeRole("superadmin", [])).status(), 200);
        assert.equal((await context.request.get(base)).status(), 200);
        assert.equal((await context.request.get(origin + "/api/admin/backups")).status(), 403);
        const superMe = await (await context.request.get(origin + "/api/auth/me")).json();
        assert.deepEqual(superMe.admin.menus, ["settings"]);
        assert.ok(await db.activityLog.count({ where: { action: "admin.menu_access.update" } }));
      } finally {
        await changeRole("superadmin", paths.roles.superadmin);
        await changeRole("admin", paths.roles.admin);
        await changeAccount(paths.accounts[account.id] || {});
        await basic.close();
      }
    });
    await t.test("Super Admin menambah role dan menetapkan izin pada akun", async () => {
      await page.goto(origin + "/admin/settings?tab=akses-menu");
      await page.getByRole("button", { name: /Tambah role/ }).click();
      await page.getByLabel("Nama role", { exact: true }).fill("Operator Penagihan");
      await page.getByRole("button", { name: "Buat role" }).click();
      await page.getByRole("dialog", { name: "Tambah role" }).waitFor({ state: "hidden" });
      assert.equal(await page.getByLabel("Role yang diatur").inputValue(), "custom-operator-penagihan");
      await page.getByRole("checkbox", { name: "Data Form", exact: true }).check();
      await page.getByRole("button", { name: "Simpan akses menu" }).click();
      await page.getByText("Aturan akses menu disimpan.", { exact: true }).waitFor();
      await page.getByRole("button", { name: "Akun admin", exact: true }).click();
      await page.getByRole("button", { name: /Tambah admin/ }).click();
      const dialog = page.getByRole("dialog", { name: "Tambah akun admin" });
      await dialog.getByLabel("Nama", { exact: true }).fill("Operator Penagihan Uji");
      await dialog.getByLabel("Email", { exact: true }).fill("routes-custom-role@bcupt.id");
      await dialog.getByLabel("Password", { exact: true }).fill("RoleBaru!2026");
      await dialog.getByRole("combobox").selectOption("custom-operator-penagihan");
      await dialog.getByRole("button", { name: "Simpan akun" }).click();
      await dialog.waitFor({ state: "hidden" });
      const newAccount = await db.admin.findUniqueOrThrow({ where: { email: "routes-custom-role@bcupt.id" } });
      assert.equal(newAccount.role, "custom-operator-penagihan");
      const operator = await browser.newContext();
      try {
        const csrf = (await (await operator.request.get(origin + "/api/csrf")).json()).token;
        const login = await operator.request.post(origin + "/api/auth/login", { headers: { "X-CSRF-Token": csrf },
          data: { email: newAccount.email, password: "RoleBaru!2026" } });
        assert.equal(login.status(), 200);
        const { admin } = await login.json();
        assert.deepEqual(admin.menus, ["data"]);
        assert.equal(admin.roleLabel, "Operator Penagihan");
      } finally { await operator.close(); }
    });
  } finally {
    await browser.close(); await closeBrowser(); await new Promise((r) => server.close(r)); await db.$disconnect();
  }
});
