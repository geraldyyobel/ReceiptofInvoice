import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { initialFields } from "../prisma/initial.js";

if (process.env.NODE_ENV !== "test") throw Error("Jalankan melalui runner database uji terpisah.");
process.env.APP_ORIGIN = "http://127.0.0.1:3198";
const { app } = await import("../server/app.js");
const { db } = await import("../server/core.js");
const { closeBrowser } = await import("../server/documents.js");

test("submit tidak gagal setelah tersimpan ketika penyimpanan browser ditolak", async (t) => {
  // Own fixture: other integration tests deliberately change the active form.
  const form = await db.formVersion.create({ data: {
    mode: "eksternal", fields: initialFields,
    sections: [{ id: "utama", label: "Informasi tagihan", firstField: "paham_ketentuan" }],
    note: "Fixture kegagalan penyimpanan browser",
  } });
  await db.form.update({ where: { mode: "eksternal" }, data: { currentId: form.id } });
  const server = app.listen(3198, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const browser = await chromium.launch({ headless: true });
  try {
    for (const failure of ["session-save", "draft-delete"]) {
      await t.test(failure, async () => {
        const context = await browser.newContext();
        try {
          const page = await context.newPage();
          const answers = {
            paham_ketentuan: "Ya",
            email_anda: "storage@example.com",
            received_from: "PT Uji Penyimpanan Browser",
            invoice_number: "STORAGE-" + failure,
            project_number: "",
            invoice_date: "2026-10-01",
            currency: "IDR",
            amount_nett: "1000.50",
            ada_ppn: "Tidak",
            invoice_jasa: "Tidak",
            ada_subvendor_1: "Tidak",
            legalitas_terkirim: "Belum",
            permintaan_via: "Email",
            po_number: "PO-STORAGE",
          };
          await page.goto("http://127.0.0.1:3198/eksternal");
          await page.locator(".question input,.question select,.question textarea,input[type=checkbox]").first().waitFor();
          const consent = page.getByRole("checkbox", {
            name: "Saya telah membaca dan memahami ketentuan",
          });
          if (await consent.count()) {
            await consent.check();
            await page.getByRole("button", { name: "Lanjut ke form" }).click();
          }
          for (let i = 0; i < 40; i++) {
            const input = page.locator(".question input,.question select,.question textarea").first();
            await input.waitFor();
            const code = (await input.getAttribute("id")).replace("field-", "");
            assert.ok(Object.hasOwn(answers, code), "Fixture jawaban tersedia: " + code);
            if ((await input.evaluate((el) => el.tagName)) === "SELECT")
              await input.selectOption(answers[code]);
            else await input.fill(answers[code]);
            await page.getByRole("button", { name: /Berikutnya|Periksa jawaban/ }).click();
            if (await page.getByRole("heading", { name: "Periksa jawaban Anda" }).count()) break;
          }
          await page.getByRole("heading", { name: "Periksa jawaban Anda" }).waitFor();
          await page.evaluate((failure) => {
            const method = failure === "session-save" ? "setItem" : "removeItem";
            const original = Storage.prototype[method];
            Storage.prototype[method] = function (key, ...args) {
              if (
                (failure === "session-save" && this === sessionStorage && key.startsWith("roi-success")) ||
                (failure === "draft-delete" && this === localStorage && key.startsWith("roi-draft"))
              ) throw new DOMException("Penyimpanan uji ditolak", "QuotaExceededError");
              return original.call(this, key, ...args);
            };
          }, failure);
          const submitted = page.waitForResponse((r) =>
            r.url().endsWith("/api/public/eksternal/submit") && r.request().method() === "POST",
          );
          await page.getByRole("button", { name: "Kirim invoice" }).click();
          const response = await submitted;
          assert.equal(response.status(), 201, "Server sudah menyimpan invoice");
          const receipt = await response.json();
          await page.getByRole("heading", { name: "Receipt of Invoice siap." }).waitFor({ timeout: 3000 });
          assert.equal(await page.locator(".reference").textContent(), receipt.reference);
          await page.getByText(/Invoice sudah tercatat\. Penyimpanan browser/).waitFor();
          assert.equal(await page.getByRole("button", { name: "Kirim invoice" }).count(), 0);
          const stored = await db.submission.findMany({
            where: { vendor: answers.received_from }, select: { values: true },
          });
          assert.equal(stored.filter((s) => s.values.invoice_number === answers.invoice_number).length, 1);
          const downloaded = page.waitForEvent("download");
          await page.getByRole("button", { name: "Unduh PDF" }).click();
          assert.equal((await downloaded).suggestedFilename(), receipt.reference + ".pdf");
          await page.getByRole("button", { name: "Isi invoice baru" }).click();
          await page.locator(".question input,.question select,.question textarea,input[type=checkbox]").first().waitFor();
          if (await consent.count()) {
            await consent.check();
            await page.getByRole("button", { name: "Lanjut ke form" }).click();
          }
          assert.equal(await page.locator("#field-paham_ketentuan").inputValue(), "");
        } finally {
          await context.close();
        }
      });
    }
  } finally {
    await browser.close();
    await closeBrowser();
    await new Promise((resolve) => server.close(resolve));
    await db.$disconnect();
  }
});
