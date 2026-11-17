import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
process.env.APP_ORIGIN = "http://127.0.0.1:3199";
const { app } = await import("../server/app.js");
const { db } = await import("../server/core.js");
const { closeBrowser } = await import("../server/documents.js");
test("browser desktop/mobile: form vendor, admin, TinyMCE dan navigasi", async () => {
  await mkdir("test-results", { recursive: true });
  const server = app.listen(3199, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const browser = await chromium.launch({ headless: true });
  const annualIds = [];
  try {
    const page = await browser.newPage({
        viewport: { width: 1440, height: 1000 },
      }),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("http://127.0.0.1:3199");
    await page.getByRole("heading", { name: /Penyerahan invoice/ }).waitFor();
    await page.screenshot({
      path: "test-results/public-desktop.png",
      fullPage: true,
    });
    await page.getByRole("link", { name: /VENDOR & MITRA/ }).click();
    await page
      .getByRole("checkbox", {
        name: "Saya telah membaca dan memahami ketentuan",
      })
      .check();
    await page.getByRole("button", { name: "Lanjut ke form" }).click();
    const answers = {
      paham_ketentuan: "Ya",
      email_anda: "ui@example.com",
      received_from: "PT Uji Browser",
      invoice_number: "INV-BROWSER",
      project_number: "PROJ-01",
      invoice_date: "2026-10-01",
      currency: "IDR",
      amount_nett: "1000.50",
      ada_ppn: "Tidak",
      invoice_jasa: "Tidak",
      ada_subvendor_1: "Tidak",
      legalitas_terkirim: "Belum",
      permintaan_via: "Email",
      po_number: "PO-UI",
    };
    await page.setViewportSize({ width: 390, height: 844 });
    for (let i = 0; i < 40; i++) {
      const input = page
        .locator(".question input,.question select,.question textarea")
        .first();
      if (!(await input.count())) break;
      const id = await input.getAttribute("id"),
        code = id.replace("field-", "");
      if ((await input.evaluate((x) => x.tagName)) === "SELECT")
        await input.selectOption(answers[code] || "Tidak");
      else await input.fill(answers[code] || "Nilai uji");
      if (i === 4) {
        await page.screenshot({
          path: "test-results/form-mobile.png",
          fullPage: true,
        });
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
        );
      }
      const next = page.getByRole("button", {
        name: /Berikutnya|Periksa jawaban/,
      });
      await next.click();
      if (
        await page
          .getByRole("heading", { name: "Periksa jawaban Anda" })
          .count()
      )
        break;
    }
    await page.getByRole("heading", { name: "Periksa jawaban Anda" }).waitFor();
    await page.getByRole("button", { name: "Kirim invoice" }).click();
    await page
      .getByRole("heading", { name: "Receipt of Invoice siap." })
      .waitFor();
    const downloadEvent = page.waitForEvent("download");
    await page.getByRole("button", { name: "Unduh PDF" }).click();
    const file = await downloadEvent;
    assert.match(file.suggestedFilename(), /\.pdf$/);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("http://127.0.0.1:3199/admin");
    await page
      .getByLabel("Email", { exact: true })
      .fill(process.env.ADMIN_EMAIL);
    await page
      .getByLabel("Password", { exact: true })
      .fill(process.env.ADMIN_PASSWORD);
    await page.getByRole("button", { name: "Masuk →" }).click();
    await page.getByRole("button", { name: /VENDOR & MITRA/ }).click();
    await page
      .getByRole("heading", { name: "Ringkasan", exact: true })
      .waitFor();
    await page.locator(".stats").waitFor();
    await page.screenshot({
      path: "test-results/admin-desktop.png",
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Editor Ketentuan", exact: false })
      .click();
    await page.locator(".tox-tinymce").waitFor({ timeout: 20000 });
    await page.frameLocator(".tox-edit-area iframe").locator("body").waitFor();
    await page
      .getByRole("button", { name: "Pratinjau tampilan vendor" })
      .click();
    await page.locator(".terms-preview").waitFor();
    for (const label of [
      "Form Builder",
      "Template Dokumen",
      "Tabel Kustom",
      "Logs & Backup",
      "Settings",
    ]) {
      await page.locator("nav").getByRole("button", { name: label }).click();
      await page
        .getByRole("heading", { name: label, exact: true })
        .first()
        .waitFor();
    }
    await page
      .locator("nav")
      .getByRole("button", { name: "Tabel Kustom" })
      .click();
    await page.locator(".custom-advanced").waitFor();
    const sync = page.getByRole("button", {
      name: "Sinkronisasi ulang",
      exact: true,
    });
    assert.equal(await sync.isVisible(), false);
    await page.locator(".custom-advanced summary").click();
    await sync.click();
    const dialog = page.getByRole("dialog", {
      name: "Konfirmasi sinkronisasi ulang",
    });
    const execute = dialog.getByRole("button", {
      name: "Jalankan sinkronisasi ulang",
    });
    assert.equal(await execute.isDisabled(), true);
    await dialog
      .getByLabel("Ketik SINKRONISASI ULANG")
      .fill("SINKRONISASI ULANG");
    assert.equal(await execute.isEnabled(), true);
    await dialog.getByRole("button", { name: "Batal" }).click();
    const edited = page
      .getByRole("textbox", { name: "Received from", exact: true })
      .first();
    await edited.fill("EDIT UI TETAP");
    const saved = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/admin/custom/cell") &&
        r.request().method() === "PUT",
    );
    await edited.press("Enter");
    assert.equal((await saved).status(), 200);
    const undo = page.getByRole("button", { name: "Undo", exact: true }),
      redo = page.getByRole("button", { name: "Redo", exact: true });
    await page.locator(".notification-bell").click();
    const notificationDialog = page.getByRole("dialog", { name: "Notifikasi terbaru" });
    await notificationDialog.waitFor();
    await page.evaluate(() => document.activeElement.blur());
    let backgroundUndo = 0;
    const watchUndo = (req) => { if (req.url().endsWith("/api/admin/custom/undo")) backgroundUndo++; };
    page.on("request", watchUndo);
    await page.keyboard.press("Control+z");
    await page.waitForTimeout(350);
    page.off("request", watchUndo);
    assert.equal(backgroundUndo, 0, "Dialog terbuka tidak boleh mengubah tabel di belakangnya");
    assert.equal(await edited.inputValue(), "EDIT UI TETAP");
    await page.keyboard.press("Escape");
    await notificationDialog.waitFor({ state: "hidden" });
    await undo.click();
    await page.locator('input[value="PT Uji Browser"]').waitFor();
    assert.equal(await redo.isEnabled(), true);
    const config = await (
      await page.request.get("http://127.0.0.1:3199/api/public/eksternal/form")
    ).json();
    const csrf = await (
      await page.request.get("http://127.0.0.1:3199/api/csrf")
    ).json();
    const incoming = await page.request.post(
      "http://127.0.0.1:3199/api/public/eksternal/submit",
      {
        headers: { "X-CSRF-Token": csrf.token },
        data: {
          formVersionId: config.form.id,
          termsVersionId: config.termsVersionId,
          termsRevision: config.termsRevision,
          accepted: true,
          startedAt: new Date().toISOString(),
          values: {
            ...answers,
            invoice_number: "INV-POLL",
            received_from: "PT Masuk Otomatis",
          },
        },
      },
    );
    assert.equal(incoming.status(), 201);
    await page
      .getByRole("heading", { name: "Tabel Kustom", exact: true })
      .click();
    await page
      .getByRole("textbox", { name: "Invoice Number", exact: true })
      .first()
      .waitFor();
    await page.locator('input[value="INV-POLL"]').waitFor({ timeout: 35000 });
    assert.equal(await edited.inputValue(), "PT Uji Browser");
    assert.equal(await redo.isEnabled(), true);
    await page.keyboard.press("Control+Shift+Z");
    await page.locator('input[value="EDIT UI TETAP"]').waitFor();
    assert.equal(await edited.inputValue(), "EDIT UI TETAP");
    assert.equal(await redo.isDisabled(), true);
    const backupResponse = await page.request.post(
      "http://127.0.0.1:3199/api/admin/backups",
      { headers: { "X-CSRF-Token": csrf.token }, data: {} },
    );
    assert.equal(backupResponse.status(), 200);
    const backup = await backupResponse.json();
    await page
      .getByRole("button", { name: "Backup tabel", exact: true })
      .click();
    const backupsDialog = page.getByRole("dialog", {
      name: "Backup Tabel Kustom",
    });
    await backupsDialog
      .getByLabel("Pilih waktu backup")
      .selectOption(backup.id);
    await backupsDialog.getByText("EDIT UI TETAP", { exact: true }).waitFor();
    const backupDownloadEvent = page.waitForEvent("download");
    await backupsDialog
      .getByRole("button", { name: "Unduh backup JSON" })
      .click();
    assert.match(
      (await backupDownloadEvent).suggestedFilename(),
      /backup-tabel-kustom-eksternal-.*\.json$/,
    );
    await page.screenshot({
      path: "test-results/custom-backups.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok((await backupsDialog.boundingBox()).width <= 390);
    await page.screenshot({
      path: "test-results/custom-backups-mobile.png",
      fullPage: true,
    });
    await backupsDialog
      .getByRole("button", { name: "Tutup", exact: true })
      .click();
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({
      path: "test-results/custom-automatic-sync.png",
      fullPage: true,
    });
    // Exercise server pagination/year selection and an out-of-order search response.
    const vendorColumn = await db.customColumn.findUnique({ where: { mode_code: { mode: "eksternal", code: "received_from" } } });
    const annualRows = Array.from({ length: 61 }, (_, i) => ({
      id: `browser-books-${i + 1}`, mode: "eksternal", bookYear: 2088, bookNumber: i + 1,
    }));
    annualIds.push(...annualRows.map((r) => r.id));
    await db.customRow.createMany({ data: annualRows });
    await db.counter.upsert({ where: { key: "book:eksternal:2088" }, create: { key: "book:eksternal:2088", value: 61 }, update: { value: 61 } });
    await db.customCell.createMany({ data: annualRows.map((r) => ({
      mode: "eksternal", rowId: r.id, columnId: vendorColumn.id, value: "PT Uji Buku 2088-" + String(r.bookNumber).padStart(2, "0"),
    })) });
    await page.locator("nav").getByRole("button", { name: "Ringkasan" }).click();
    await page.locator("nav").getByRole("button", { name: "Tabel Kustom" }).click();
    await page.getByLabel("Tahun buku tabel kustom").selectOption("2088");
    await page.locator('tr[data-book-number="1"][data-book-year="2088"]').waitFor();
    assert.equal(await page.locator(".custom-table tbody tr[data-book-number]").count(), 50);
    await page.locator(".pager").getByRole("button", { name: "Berikutnya" }).click();
    await page.locator('tr[data-book-number="51"][data-book-year="2088"]').waitFor();
    assert.equal(await page.locator(".custom-table tbody tr[data-book-number]").count(), 11);
    await page.route("**/api/admin/custom?**", async (route) => {
      if (new URL(route.request().url()).searchParams.get("q") === "UJI-LAMBAT")
        await new Promise((resolve) => setTimeout(resolve, 1000));
      await route.continue();
    });
    const search = page.getByRole("textbox", { name: "Cari tabel kustom", exact: true });
    const slow = page.waitForRequest((r) => new URL(r.url()).searchParams.get("q") === "UJI-LAMBAT");
    await search.fill("UJI-LAMBAT");
    const delayed = await slow;
    await search.fill("2088-61");
    await page.locator('tr[data-book-number="61"]').waitFor();
    await (await delayed.response()).finished();
    assert.equal(await page.locator(".custom-table tbody tr[data-book-number]").count(), 1);
    assert.equal(await page.locator('tr[data-book-number="61"]').count(), 1);
    await page.screenshot({ path: "test-results/annual-custom-browser.png", fullPage: true });
    await page.unroute("**/api/admin/custom?**");
    await search.fill("");
    await page.locator('tr[data-book-number="1"][data-book-year="2088"]').waitFor();
    await page.getByLabel("Tahun buku tabel kustom").selectOption("all");
    await page.locator(".book-year-heading").first().waitFor();
    await page.locator(".pager").getByRole("button", { name: "Berikutnya" }).click();
    await page.locator('tr[data-book-year="2026"]').first().waitFor();
    assert.deepEqual(await page.locator(".book-year-heading").allTextContents(), ["Pembukuan 2088", "Pembukuan 2026"]);
    await page
      .locator("nav")
      .getByRole("button", { name: "Settings", exact: false })
      .click();
    await page
      .locator(".settings-nav")
      .getByRole("button", { name: "Backup", exact: true })
      .click();
    assert.equal(
      await page
        .getByLabel("Backup pertama (zona waktu aplikasi)")
        .inputValue(),
      "00:00",
    );
    assert.equal(
      await page.getByLabel("Backup kedua (zona waktu aplikasi)").inputValue(),
      "12:00",
    );
    await page
      .locator(".settings-nav")
      .getByRole("button", { name: "Email / SMTP", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Login Gmail", exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "Login Outlook", exact: true })
      .waitFor();
    assert.equal(
      await page.getByLabel("Metode pengiriman email").inputValue(),
      "smtp",
    );
    await page.getByLabel("Host SMTP", { exact: true }).waitFor();
    await page.screenshot({
      path: "test-results/email-oauth-settings.png",
      fullPage: true,
    });
    await page
      .locator("nav")
      .getByRole("button", { name: "Editor Ketentuan" })
      .click();
    const toggle = page.getByRole("switch", { name: "Tampilkan ketentuan" });
    await toggle.waitFor();
    const [off] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().endsWith("/api/admin/terms/visibility") &&
          r.request().method() === "PUT",
      ),
      toggle.click(),
    ]);
    assert.equal(off.status(), 200);
    await page
      .getByRole("switch", { name: "Tampilkan ketentuan", checked: false })
      .waitFor();
    const visitor = await browser.newPage();
    await visitor.goto("http://127.0.0.1:3199/");
    await visitor.getByRole("link", { name: /VENDOR & MITRA/ }).click();
    await visitor.locator("#field-email_anda").waitFor();
    assert.equal(
      await visitor
        .getByRole("checkbox", {
          name: "Saya telah membaca dan memahami ketentuan",
        })
        .count(),
      0,
    );
    const [on] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().endsWith("/api/admin/terms/visibility") &&
          r.request().method() === "PUT",
      ),
      toggle.click(),
    ]);
    assert.equal(on.status(), 200);
    await page
      .getByRole("switch", { name: "Tampilkan ketentuan", checked: true })
      .waitFor();
    await visitor.goto("http://127.0.0.1:3199/");
    await visitor.getByRole("link", { name: /VENDOR & MITRA/ }).click();
    await visitor
      .getByRole("checkbox", {
        name: "Saya telah membaca dan memahami ketentuan",
      })
      .waitFor();
    await visitor.close();
    const direct = await browser.newPage();
    await direct.goto("http://127.0.0.1:3199/");
    assert.equal(
      await direct
        .getByRole("link", { name: /LINGKUNGAN BCU/ })
        .getAttribute("href"),
      "/internal",
    );
    assert.equal(
      await direct
        .getByRole("link", { name: /VENDOR & MITRA/ })
        .getAttribute("href"),
      "/eksternal",
    );
    await direct.evaluate(() =>
      sessionStorage.setItem(
        "roi-success-eksternal",
        JSON.stringify({ mode: "eksternal", reference: "CONTOH" }),
      ),
    );
    await direct.goto("http://127.0.0.1:3199/internal");
    await direct
      .getByRole("checkbox", {
        name: "Saya telah membaca dan memahami ketentuan",
      })
      .waitFor();
    assert.equal(
      (await direct.locator(".mode-badge").innerText()).toLowerCase(),
      "internal",
    );
    assert.equal(await direct.locator(".success").count(), 0);
    await direct.reload();
    await direct
      .getByRole("checkbox", {
        name: "Saya telah membaca dan memahami ketentuan",
      })
      .waitFor();
    await direct.locator("a").filter({ hasText: "Pilih jenis" }).click();
    await direct.getByRole("heading", { name: /Penyerahan invoice/ }).waitFor();
    await direct.evaluate(() => {
      sessionStorage.removeItem("roi-success-eksternal");
      sessionStorage.setItem(
        "roi-success",
        JSON.stringify({ mode: "internal" }),
      );
    });
    await direct.goto("http://127.0.0.1:3199/eksternal/");
    await direct
      .getByRole("checkbox", {
        name: "Saya telah membaca dan memahami ketentuan",
      })
      .waitFor();
    assert.equal(
      (await direct.locator(".mode-badge").innerText()).toLowerCase(),
      "eksternal",
    );
    await direct.close();
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    await closeBrowser();
    await db.customCell.deleteMany({ where: { rowId: { in: annualIds } } });
    await db.customRow.deleteMany({ where: { id: { in: annualIds } } });
    await new Promise((r) => server.close(r));
    await db.$disconnect();
  }
});
