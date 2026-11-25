import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import bcrypt from "bcryptjs";
process.env.APP_ORIGIN = "http://127.0.0.1:3185";
const { app } = await import("../server/app.js");
const { db } = await import("../server/core.js");
const { createBackup, restoreBackup } = await import("../server/backup.js");
if (process.env.NODE_ENV !== "test") throw Error("Gunakan database uji terpisah");
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };

test("panel detail kustom: desktop/mobile, draf, konflik, navigasi, izin dan respons terlambat", async (t) => {
  const baseline = await createBackup({ ip: "panel-test-baseline" });
  const server = app.listen(3185, "127.0.0.1"); await new Promise((resolve) => server.once("listening", resolve));
  const browser = await chromium.launch({ headless: true });
  const origin = "http://127.0.0.1:3185", out = path.resolve("test-results/custom-panel");
  await fs.mkdir(out, { recursive: true });
  let context, source, first, second, columns, csrf;
  const settle = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const isRow = (response, method, id = first.id) => new URL(response.url()).pathname === "/api/admin/custom/rows/" + id && response.request().method() === method;
  const login = async (ctx, email = process.env.ADMIN_EMAIL, password = process.env.ADMIN_PASSWORD) => {
    const token = (await (await ctx.request.get(origin + "/api/csrf")).json()).token;
    const result = await ctx.request.post(origin + "/api/auth/login", { headers: { "X-CSRF-Token": token }, data: { email, password } });
    assert.equal(result.status(), 200); return token;
  };
  const openPage = async (number = 1, viewport = { width: 1440, height: 1000 }, ctx = context, waitRead = true) => {
    const page = await ctx.newPage(); await page.setViewportSize(viewport);
    await page.goto(origin + "/admin/internal/tabel-kustom");
    await page.getByLabel("Tahun buku tabel kustom").selectOption("2091");
    const row = page.locator(`.custom-table tr[data-book-year="2091"][data-book-number="${number}"]`); await row.waitFor();
    if (number) {
      const loaded = waitRead ? page.waitForResponse((r) => isRow(r, "GET", number === 1 ? first.id : number === 2 ? second.id : first.id)) : null;
      await row.locator("small").first().click();
      await page.getByRole("dialog", { name: "Detail baris tabel kustom" }).waitFor();
      if (loaded && number <= 2) { await loaded; await settle(page); }
    }
    return page;
  };
  const dialog = (page) => page.getByRole("dialog", { name: "Detail baris tabel kustom" });
  const saveReview = async (page, key, action) => { const saved = page.waitForResponse((r) => isRow(r, "PATCH") && Object.hasOwn(r.request().postDataJSON(), key)); await action(); assert.equal((await saved).status(), 200); await dialog(page).getByRole("status").filter({ hasText: "Tersimpan" }).waitFor(); };
  const saveCell = async (page, label, value) => {
    const saved = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/admin/custom/cell" && r.request().method() === "PUT");
    const input = dialog(page).getByLabel(label, { exact: true }); await input.fill(value); await input.blur();
    assert.equal((await saved).status(), 200); await settle(page);
  };
  const resetReview = () => db.customRow.update({ where: { id: first.id }, data: { reviewChecked: false, reviewFlag: null, reviewNote: null } });
  try {
    context = await browser.newContext(); csrf = await login(context);
    const post = (url, data) => context.request.post(origin + url, { headers: { "X-CSRF-Token": csrf, "X-ROI-Mode": "internal" }, data });
    const publicForm = await (await context.request.get(origin + "/api/public/internal/form")).json();
    const email = publicForm.form.fields.find((f) => f.code === "email_anda");
    const submitted = await post("/api/public/internal/submit", { formVersionId: publicForm.form.id, termsVersionId: publicForm.termsVersionId,
      termsRevision: publicForm.termsRevision, accepted: true, startedAt: new Date().toISOString(), values: {
        paham_ketentuan: "Ya", email_anda: email.type === "select" ? email.options[0].value : "panel@example.test",
        received_from: "PT Master Panel Uji", invoice_number: "PANEL-001", invoice_date: "2091-03-01", currency: "IDR", amount_nett: 125,
        ada_ppn: "Tidak", invoice_jasa: "Tidak", ada_subvendor_1: "Tidak", legalitas_terkirim: "Belum", permintaan_via: "Email", po_number: "PO-PANEL",
      } });
    assert.equal(submitted.status(), 201); source = await submitted.json();
    first = await db.customRow.findFirst({ where: { mode: "internal", masterId: source.id } });
    assert.equal(first.bookNumber, 1);
    second = await (await post("/api/admin/custom/rows", { year: 2091 })).json();
    for (const [code, label, type, options, hidden] of [["received_from", "Received from", "short", [], false], ["amount_nett", "Amount (Nett)", "number", [], false],
      ["invoice_date", "Date", "date", [], false], ["currency", "Currency", "select", ["IDR", "USD"], false], ["project_number", "Project Number", "short", [], true],
      ["panel_checkbox", "Konfirmasi dokumen", "checkbox", [], false]]) {
      await db.customColumn.upsert({ where: { mode_code: { mode: "internal", code } }, create: { mode: "internal", code, label, type, options, hidden, position: 999 }, update: { label, type, options, hidden } });
    }
    columns = await db.customColumn.findMany({ where: { mode: "internal" } });
    const vendor = columns.find((c) => c.code === "received_from");
    await db.customCell.updateMany({ where: { rowId: first.id, columnId: vendor.id }, data: { value: "Vendor kustom awal" } });
    await db.customRow.createMany({ data: Array.from({ length: 50 }, (_, i) => ({ id: "panel-row-" + i, mode: "internal", bookYear: 2091, bookNumber: i + 3 })) });
    await db.counter.upsert({ where: { key: "book:internal:2091" }, create: { key: "book:internal:2091", value: 52 }, update: { value: 52 } });
    await t.test("endpoint detail hanya membaca satu baris dan menjaga mode/izin", async () => {
      const before = await db.customHistory.findMany();
      const result = await context.request.get(origin + "/api/admin/custom/rows/" + first.id, { headers: { "X-ROI-Mode": "internal" } });
      assert.equal(result.status(), 200); const data = await result.json(); assert.equal(data.row.id, first.id); assert.ok(data.cells.every((c) => c.rowId === first.id));
      assert.equal((await context.request.get(origin + "/api/admin/custom/rows/" + first.id, { headers: { "X-ROI-Mode": "eksternal" } })).status(), 404);
      assert.deepEqual(await db.customHistory.findMany(), before);
      const anonymous = await browser.newContext();
      assert.equal((await anonymous.request.get(origin + "/api/admin/custom/rows/" + first.id)).status(), 401); await anonymous.close();
      const readerAccount = await db.admin.create({ data: { name: "Pembaca master", email: "panel-reader@bcupt.id", role: "user", password: await bcrypt.hash("PanelUji!2026", 4) } });
      const reader = await browser.newContext(); await login(reader, readerAccount.email, "PanelUji!2026");
      assert.equal((await reader.request.get(origin + "/api/admin/custom/rows/" + first.id, { headers: { "X-ROI-Mode": "internal" } })).status(), 403); await reader.close();
    });
    await t.test("timer pencarian awal tidak mengembalikan pagination ke halaman pertama", async () => {
      const page = await context.newPage();
      try {
        const now = new Date(); await page.clock.install({ time: now }); await page.clock.pauseAt(now);
        await page.goto(origin + "/admin/internal/tabel-kustom");
        await page.getByLabel("Tahun buku tabel kustom").selectOption("2091");
        await page.locator('tr[data-book-number="1"][data-book-year="2091"]').waitFor();
        await page.locator(".pager").getByRole("button", { name: "Berikutnya" }).evaluate((el) => el.click());
        const secondPage = page.locator('tr[data-book-number="51"][data-book-year="2091"]'); await secondPage.waitFor();
        await page.clock.fastForward(301); await page.clock.runFor(100);
        assert.equal(await secondPage.count(), 1);
      } finally { await page.clock.resume(); await page.close(); }
    });
    await t.test("buka/tutup, sorotan, Esc, fokus kembali dan perangkap Tab", async () => {
      const page = await openPage(); try {
        const panel = dialog(page); assert.equal(await panel.evaluate((el) => document.activeElement === el), true);
        assert.equal(await panel.evaluate((el) => getComputedStyle(el).getPropertyValue("--primary")),
          await page.locator(".admin-shell").evaluate((el) => getComputedStyle(el).getPropertyValue("--primary")));
        assert.equal(await page.locator(".custom-row-active").count(), 1);
        await page.keyboard.press("Tab"); assert.equal(await panel.getByRole("button", { name: "Tutup detail baris" }).evaluate((el) => document.activeElement === el), true);
        await page.keyboard.press("Shift+Tab"); assert.equal(await panel.getByRole("button", { name: "Berikutnya" }).evaluate((el) => document.activeElement === el), true);
        await page.keyboard.press("Tab"); assert.equal(await panel.getByRole("button", { name: "Tutup detail baris" }).evaluate((el) => document.activeElement === el), true);
        await page.keyboard.press("Escape"); await panel.waitFor({ state: "hidden" }); await settle(page);
        assert.equal(await page.locator('tr[data-book-number="1"][data-book-year="2091"]').evaluate((el) => document.activeElement === el), true);
        assert.equal(await page.locator(".custom-row-active").count(), 0);
        assert.equal(await page.locator('.custom-table input,.custom-table select').count(), 0, "tabel menampilkan nilai; edit dilakukan di Detail");
        const row = page.locator('tr[data-book-number="1"][data-book-year="2091"]');
        assert.ok((await row.boundingBox()).height <= 66, "baris tabel tetap rapat");
        assert.ok((await page.locator('.custom-scroll').boundingBox()).y < 360, "kontrol tidak menghabiskan layar di atas tabel");
        await page.screenshot({ path: path.join(out, "desktop-table.png") });
        await row.getByRole("button", { name: "Detail", exact: false }).click(); await panel.waitFor();
      } finally { await page.close(); }
    });
    await t.test("seluruh tipe field, kolom tersembunyi dan pembanding master", async () => {
      const page = await openPage(); try {
        const panel = dialog(page); await panel.getByText("Master: PT Master Panel Uji", { exact: true }).waitFor();
        await saveCell(page, "Received from", "Vendor dari panel");
        await saveCell(page, "Amount (Nett)", "150.25");
        await saveCell(page, "Date", "2091-04-01");
        await saveCell(page, "Project Number", "PROYEK TERSEMBUNYI");
        let saved = page.waitForResponse((r) => new URL(r.url()).pathname.endsWith("/custom/cell"));
        await panel.getByLabel("Currency", { exact: true }).selectOption("USD"); assert.equal((await saved).status(), 200);
        saved = page.waitForResponse((r) => new URL(r.url()).pathname.endsWith("/custom/cell"));
        await panel.getByLabel("Konfirmasi dokumen", { exact: true }).check(); assert.equal((await saved).status(), 200);
        const master = await db.submission.findUnique({ where: { id: source.id } }); assert.equal(master.values.received_from, "PT Master Panel Uji");
        assert.equal(master.values.amount_nett, 125);
      } finally { await page.close(); }
    });
    await t.test("review parsial, penanda dapat dikosongkan, batas catatan dan Undo/Redo", async () => {
      await resetReview(); const page = await openPage(); const bodies = [];
      page.on("request", (r) => { if (r.method() === "PATCH" && new URL(r.url()).pathname.endsWith("/rows/" + first.id)) bodies.push(r.postDataJSON()); });
      try {
        const panel = dialog(page);
        await saveReview(page, "reviewChecked", () => panel.getByLabel("Dicek", { exact: true }).check());
        await panel.getByRole("button", { name: "Undo", exact: false }).click(); await panel.getByLabel("Dicek", { exact: true }).waitFor({ state: "visible" });
        await page.waitForFunction(() => !document.querySelector('.custom-panel-review input[type="checkbox"]').checked);
        await panel.getByRole("button", { name: "Redo", exact: false }).click(); await page.waitForFunction(() => document.querySelector('.custom-panel-review input[type="checkbox"]').checked);
        await saveReview(page, "reviewFlag", () => panel.getByRole("button", { name: "Perlu tindak lanjut" }).click());
        await saveReview(page, "reviewFlag", () => panel.getByRole("button", { name: "Bermasalah", exact: true }).click());
        await saveReview(page, "reviewFlag", () => panel.getByRole("button", { name: "Hapus penanda" }).click());
        const note = panel.getByLabel("Catatan review", { exact: true }); await note.fill("x".repeat(2001)); assert.equal((await note.inputValue()).length, 2000);
        await saveReview(page, "reviewNote", () => note.press("Tab"));
        assert.equal(bodies.every((b) => ["reviewChecked", "reviewFlag", "reviewNote"].filter((k) => Object.hasOwn(b, k)).length === 1), true);
        let undos = 0; page.on("request", (r) => { if (r.url().endsWith("/custom/undo")) undos++; });
        await note.fill("Teks lokal"); await note.press("Control+z"); assert.equal(undos, 0);
      } finally { await page.close(); }
    });
    await t.test("navigasi hanya pada halaman aktif, J/K tidak berjalan saat mengetik", async () => {
      const page = await openPage(); try {
        let panel = dialog(page); assert.equal(await panel.getByRole("button", { name: "Sebelumnya" }).isDisabled(), true);
        await panel.getByRole("button", { name: "Berikutnya" }).click(); await panel.getByText("2 dari 50", { exact: true }).waitFor();
        await panel.focus(); await page.keyboard.press("j"); await panel.getByText("3 dari 50", { exact: true }).waitFor();
        await panel.focus(); await page.keyboard.press("k"); await panel.getByText("2 dari 50", { exact: true }).waitFor();
        await panel.getByLabel("Catatan review").fill("j k"); await panel.getByLabel("Catatan review").press("j");
        assert.equal(await panel.getByText("2 dari 50", { exact: true }).count(), 1);
        await page.keyboard.press("Escape"); await panel.waitFor({ state: "hidden" });
        const last = page.locator('tr[data-book-number="50"][data-book-year="2091"]'); await last.focus(); await last.press("Enter");
        panel = dialog(page); await panel.getByText("50 dari 50", { exact: true }).waitFor(); assert.equal(await panel.getByRole("button", { name: "Berikutnya" }).isDisabled(), true);
      } finally { await page.close(); }
    });
    await t.test("konflik 409 mempertahankan draf; Muat ulang dan Timpa adalah pilihan eksplisit", async () => {
      await resetReview(); const page = await openPage(); try {
        const panel = dialog(page), note = panel.getByLabel("Catatan review");
        await db.customRow.update({ where: { id: first.id }, data: { reviewNote: "Catatan terbaru admin B" } });
        await note.fill("Draf saya tetap ada"); await note.press("Tab"); await panel.getByRole("button", { name: "Timpa", exact: true }).waitFor();
        assert.equal(await note.inputValue(), "Draf saya tetap ada"); await panel.getByText("Catatan terbaru admin B", { exact: true }).waitFor();
        await panel.getByRole("button", { name: "Muat ulang", exact: true }).click(); await page.waitForFunction(() => document.querySelector('.custom-panel-review textarea').value === "Catatan terbaru admin B");
        await db.customRow.update({ where: { id: first.id }, data: { reviewNote: "Versi admin B kedua", reviewChecked: true } });
        await note.fill("Timpa yang disengaja"); await note.press("Tab"); await panel.getByRole("button", { name: "Timpa", exact: true }).waitFor();
        await saveReview(page, "reviewNote", () => panel.getByRole("button", { name: "Timpa", exact: true }).click());
        const row = await db.customRow.findUnique({ where: { id: first.id } }); assert.equal(row.reviewNote, "Timpa yang disengaja"); assert.equal(row.reviewChecked, true);
      } finally { await page.close(); }
    });
    await t.test("gagal jaringan, tutup/buka dan refresh tidak menghapus draf; Coba lagi menyimpan", async () => {
      await resetReview(); const page = await openPage(); const pattern = "**/api/admin/custom/rows/" + first.id;
      const intercept = async (route) => route.request().method() === "PATCH" ? route.abort("failed") : route.continue();
      try {
        await page.route(pattern, intercept); const panel = dialog(page);
        await panel.getByLabel("Catatan review").fill("Draf saat koneksi putus"); await panel.getByLabel("Catatan review").press("Tab");
        await panel.getByRole("button", { name: "Coba lagi", exact: true }).waitFor();
        await page.keyboard.press("Escape"); await panel.waitFor({ state: "hidden" }); await page.reload();
        await page.getByLabel("Tahun buku tabel kustom").selectOption("2091"); await page.locator('tr[data-book-number="1"][data-book-year="2091"] small').first().click();
        await panel.waitFor(); assert.equal(await panel.getByLabel("Catatan review").inputValue(), "Draf saat koneksi putus");
        await page.unroute(pattern, intercept); await saveReview(page, "reviewNote", () => panel.getByRole("button", { name: "Coba lagi", exact: true }).click());
      } finally { await page.close(); }
    });
    await t.test("kegagalan sel mempertahankan isi dan dapat dicoba kembali", async () => {
      const page = await openPage();
      const intercept = (route) => route.abort("failed");
      try {
        await page.route("**/api/admin/custom/cell", intercept);
        const input = dialog(page).getByLabel("Received from", { exact: true }); await input.fill("Draf vendor ketika putus"); await input.blur();
        const retry = dialog(page).getByRole("button", { name: "Coba lagi: Received from", exact: true }); await retry.waitFor();
        assert.equal(await input.inputValue(), "Draf vendor ketika putus");
        await page.unroute("**/api/admin/custom/cell", intercept);
        const saved = page.waitForResponse((r) => new URL(r.url()).pathname.endsWith("/custom/cell"));
        await retry.click(); assert.equal((await saved).status(), 200);
        await retry.waitFor({ state: "hidden" }); assert.equal(await input.inputValue(), "Draf vendor ketika putus");
      } finally { await page.close(); }
    });
    await t.test("teks baru yang diketik saat simpan berlangsung tetap menjadi draf", async () => {
      await resetReview(); const page = await openPage(), release = deferred(), started = deferred(), delivered = deferred(); let held = false;
      try {
        await page.route("**/api/admin/custom/rows/" + first.id, async (route) => {
          if (route.request().method() !== "PATCH" || held) return route.continue(); held = true;
          const response = await route.fetch(); started.resolve(); await release.promise; await route.fulfill({ response }); delivered.resolve();
        });
        const note = dialog(page).getByLabel("Catatan review"); await note.fill("Versi terkirim"); await note.blur(); await started.promise;
        await note.fill("Teks baru yang belum dikirim"); release.resolve(); await delivered.promise; await settle(page);
        assert.equal(await note.inputValue(), "Teks baru yang belum dikirim");
        assert.equal((await db.customRow.findUnique({ where: { id: first.id } })).reviewNote, "Versi terkirim");
        await saveReview(page, "reviewNote", () => note.blur());
      } finally { release.resolve(); await page.close(); }
    });
    await t.test("membuka kembali baris saat balasan lama tertahan tidak kehilangan draf terbaru", async () => {
      await resetReview(); const page = await openPage(), release = deferred(), started = deferred(), delivered = deferred();
      try {
        await page.route("**/api/admin/custom/rows/" + first.id, async (route) => {
          if (route.request().method() !== "PATCH") return route.continue();
          const response = await route.fetch(); started.resolve(); await release.promise; await route.fulfill({ response }); delivered.resolve();
        });
        await dialog(page).getByLabel("Catatan review").fill("Versi simpan lama"); await dialog(page).getByLabel("Catatan review").blur(); await started.promise;
        await dialog(page).getByRole("button", { name: "Berikutnya" }).click(); await dialog(page).getByText("2 dari 50", { exact: true }).waitFor();
        const read = page.waitForResponse((r) => isRow(r, "GET"));
        await dialog(page).getByRole("button", { name: "Sebelumnya" }).click(); await read; await settle(page);
        await dialog(page).getByLabel("Catatan review").fill("Draf baru setelah kembali");
        release.resolve(); await delivered.promise; await settle(page);
        assert.equal(await dialog(page).getByLabel("Catatan review").inputValue(), "Draf baru setelah kembali");
        const drafts = await page.evaluate(() => [...Array(sessionStorage.length)].map((_, i) => sessionStorage.getItem(sessionStorage.key(i))).join(" "));
        assert.ok(drafts.includes("Draf baru setelah kembali"));
      } finally { release.resolve(); await page.close(); }
    });
    await t.test("respons PATCH baris sebelumnya tidak menimpa panel baris berikutnya", async () => {
      await resetReview(); const page = await openPage(), release = deferred(), started = deferred(), delivered = deferred();
      try {
        await page.route("**/api/admin/custom/rows/" + first.id, async (route) => {
          if (route.request().method() !== "PATCH") return route.continue();
          const response = await route.fetch(); started.resolve(); await release.promise; await route.fulfill({ response }); delivered.resolve();
        });
        await dialog(page).getByLabel("Catatan review").fill("Balasan tertunda baris satu"); await dialog(page).getByLabel("Catatan review").press("Tab"); await started.promise;
        await dialog(page).getByRole("button", { name: "Berikutnya" }).click(); await dialog(page).getByText("2 dari 50", { exact: true }).waitFor();
        const value = await dialog(page).getByLabel("Catatan review").inputValue(); release.resolve(); await delivered.promise; await settle(page);
        assert.equal(await dialog(page).getByLabel("Catatan review").inputValue(), value); assert.equal(await dialog(page).getByText("2 dari 50", { exact: true }).count(), 1);
      } finally { release.resolve(); await page.close(); }
    });
    await t.test("respons GET/master baris lama tidak menimpa panel baru", async () => {
      const page = await context.newPage(), release = deferred(), held = deferred(), delivered = deferred(), masterDelivered = deferred();
      try {
        await page.route("**/api/admin/custom/rows/" + first.id, async (route) => { if (route.request().method() !== "GET") return route.continue(); const response = await route.fetch(); held.resolve(); await release.promise; await route.fulfill({ response }); delivered.resolve(); });
        await page.route("**/api/admin/submissions/" + source.id, async (route) => { const response = await route.fetch(); await release.promise; await route.fulfill({ response }); masterDelivered.resolve(); });
        await page.goto(origin + "/admin/internal/tabel-kustom"); await page.getByLabel("Tahun buku tabel kustom").selectOption("2091");
        await page.locator('tr[data-book-number="1"][data-book-year="2091"] small').first().click(); await held.promise;
        await dialog(page).getByRole("button", { name: "Berikutnya" }).click(); await dialog(page).getByText("2 dari 50", { exact: true }).waitFor();
        release.resolve(); await Promise.all([delivered.promise, masterDelivered.promise]); await settle(page); assert.equal(await dialog(page).getByText("Master: PT Master Panel Uji", { exact: true }).count(), 0);
      } finally { release.resolve(); await page.close(); }
    });
    await t.test("respons simpan lama setelah tanggal berubah tidak mengembalikan tahun lama", async () => {
      await resetReview(); const page = await openPage(), release = deferred(), started = deferred(), delivered = deferred();
      try {
        await page.route("**/api/admin/custom/rows/" + first.id, async (route) => {
          if (route.request().method() !== "PATCH") return route.continue(); const response = await route.fetch(); started.resolve(); await release.promise; await route.fulfill({ response }); delivered.resolve();
        });
        await dialog(page).getByLabel("Catatan review").fill("Draf lintas tahun"); await dialog(page).getByLabel("Catatan review").press("Tab"); await started.promise;
        await saveCell(page, "Date", "2092-01-01"); await dialog(page).getByText(/Baris telah berpindah tahun buku/).waitFor();
        release.resolve(); await delivered.promise; await settle(page); assert.match(await dialog(page).locator("header p").innerText(), /2092/);
        assert.equal(await dialog(page).getByLabel("Catatan review").inputValue(), "Draf lintas tahun");
        await dialog(page).getByRole("button", { name: "Muat ulang baris" }).click();
        await dialog(page).getByRole("button", { name: "Perlu tindak lanjut" }).waitFor();
      } finally {
        release.resolve(); await page.close();
        await db.customRow.update({ where: { id: first.id }, data: { bookYear: 2091, bookNumber: 1 } });
        const date = columns.find((c) => c.code === "invoice_date"); await db.customCell.updateMany({ where: { rowId: first.id, columnId: date.id }, data: { value: "2091-04-01" } });
      }
    });
    await t.test("baris dihapus atau dipindah admin lain ditampilkan sebagai tidak tersedia", async () => {
      const page = await openPage(2); try {
        await db.customCell.deleteMany({ where: { rowId: second.id } }); await db.customRow.delete({ where: { id: second.id } });
        await dialog(page).getByRole("button", { name: "Periksa pembaruan" }).click(); await dialog(page).getByText(/Baris tidak lagi tersedia atau telah dihapus/).waitFor();
        assert.equal(await dialog(page).getByLabel("Dicek", { exact: true }).isDisabled(), true);
      } finally { await page.close(); await db.customRow.create({ data: { ...second, createdAt: new Date(second.createdAt) } }); }
      const movedPage = await openPage(); try {
        await db.customRow.update({ where: { id: first.id }, data: { bookYear: 2092, bookNumber: 100 } });
        await dialog(movedPage).getByLabel("Catatan review").fill("Draf ketika tahun berubah");
        await dialog(movedPage).getByLabel("Catatan review").blur();
        await dialog(movedPage).getByText(/Baris telah berpindah tahun buku/).waitFor();
        assert.match(await dialog(movedPage).locator("header p").innerText(), /2092/);
        assert.equal(await dialog(movedPage).getByLabel("Catatan review").inputValue(), "Draf ketika tahun berubah");
      } finally { await movedPage.close(); await db.customRow.update({ where: { id: first.id }, data: { bookYear: 2091, bookNumber: 1 } }); }
    });
    await t.test("polling daftar berhenti selama panel terbuka dan berjalan lagi setelah ditutup", async () => {
      const page = await openPage(); try {
        await page.clock.install(); let lists = 0;
        page.on("request", (r) => { if (new URL(r.url()).pathname === "/api/admin/custom") lists++; });
        await page.clock.fastForward(31000); assert.equal(lists, 0);
        await page.keyboard.press("Escape"); await page.clock.runFor(100); await settle(page); const afterClose = lists;
        await page.clock.fastForward(16000); assert.ok(lists > afterClose);
      } finally { await page.close(); }
    });
    await t.test("akun tanpa Data Form dan baris manual tidak meminta pembanding master", async () => {
      const account = await db.admin.create({ data: { name: "Panel tanpa master", email: "panel-custom-only@bcupt.id", role: "admin", password: await bcrypt.hash("PanelUji!2026", 4) } });
      await db.setting.upsert({ where: { key: "admin_menu:account:" + account.id }, create: { key: "admin_menu:account:" + account.id, value: { custom: true, data: false } }, update: { value: { custom: true, data: false } } });
      const restricted = await browser.newContext(); await login(restricted, account.email, "PanelUji!2026");
      try {
        let restrictedMasterRequests = 0;
        await restricted.route("**/api/admin/submissions/**", async (route) => { restrictedMasterRequests++; await route.continue(); });
        const page = await openPage(1, { width: 1440, height: 1000 }, restricted); let requests = 0;
        assert.equal(restrictedMasterRequests, 0, "akun tanpa izin Data Form tidak meminta master");
        assert.equal(await dialog(page).locator(".custom-master-value").count(), 0);
        const master = await restricted.request.get(origin + "/api/admin/submissions/" + source.id, { headers: { "X-ROI-Mode": "internal" } }); assert.equal(master.status(), 403);
        await page.close();
        const manual = await context.newPage(); manual.on("request", (r) => { if (new URL(r.url()).pathname.startsWith("/api/admin/submissions/")) requests++; });
        await manual.goto(origin + "/admin/internal/tabel-kustom"); await manual.getByLabel("Tahun buku tabel kustom").selectOption("2091");
        await manual.locator('tr[data-book-number="2"][data-book-year="2091"] small').first().click(); await dialog(manual).waitFor(); await settle(manual);
        assert.equal(requests, 0); assert.equal(await dialog(manual).locator(".custom-master-value").count(), 0); await manual.close();
      } finally { await restricted.close(); }
    });
    await t.test("screenshot desktop/mobile: penanda, catatan, konflik dan lebar responsif", async () => {
      for (const [label, viewport] of [["desktop", { width: 1440, height: 1100 }], ["mobile", { width: 390, height: 1100 }]]) {
        await db.customRow.update({ where: { id: first.id }, data: { reviewChecked: true, reviewFlag: "problem", reviewNote: "Mohon lengkapi dokumen pendukung sebelum diproses." } });
        const page = await openPage(1, viewport); try {
          const panel = dialog(page); assert.ok((await panel.boundingBox()).width <= viewport.width);
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
          await page.screenshot({ path: path.join(out, label + "-review.png") });
          await db.customRow.update({ where: { id: first.id }, data: { reviewNote: "Admin lain: dokumen sudah diterima, perlu verifikasi." } });
          await panel.getByLabel("Catatan review").fill("Draf saya: hubungi vendor untuk konfirmasi besok."); await panel.getByLabel("Catatan review").press("Tab");
          await panel.getByRole("button", { name: "Timpa", exact: true }).waitFor();
          await panel.locator(".review-conflict").scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(out, label + "-conflict.png") });
        } finally { await page.close(); }
      }
    });
  } finally {
    await browser.close(); await new Promise((resolve) => server.close(resolve));
    await restoreBackup(baseline.id, { ip: "panel-test-cleanup" }); await db.$disconnect();
  }
});
