import { writeFile, mkdir } from "node:fs/promises";
import { db, settings, renderHtml } from "../server/core.js";
import { pdfBuffer, closeBrowser } from "../server/documents.js";
import { chromium } from "playwright";
const values = {
  received_from: "PT Contoh Vendor (DATA DEMO)",
  invoice_number: "INV/2026/001",
  invoice_date: "2026-11-02",
  currency: "IDR",
  amount_nett: 1000000,
  vat: 110000,
  nsfp: "010.000-26.12345678",
  po_number: "PO/BCU/001",
  legalitas_terkirim: "Sudah",
  legalitas_tanggal: "2026-10-01",
  nitku: "0123456789012345000000",
  vendor_1_nama: "PT Sub Vendor Satu",
  vendor_1_kontak: "0812-0000-0001",
  vendor_2_nama: "PT Sub Vendor Dua",
  vendor_2_kontak: "0812-0000-0002",
  vendor_3_nama: "PT Sub Vendor Tiga",
  vendor_3_kontak: "0812-0000-0003",
  vendor_4_nama: "PT Sub Vendor Empat",
  vendor_4_kontak: "0812-0000-0004",
};
let browser;
try {
  await mkdir("examples", { recursive: true });
  await mkdir("test-results", { recursive: true });
  browser = await chromium.launch({ headless: true });
  for (const mode of ["internal", "eksternal"]) {
    const pointer = await db.docTemplate.findUniqueOrThrow({ where: { mode } }),
      template = await db.templateVersion.findUniqueOrThrow({
        where: { id: pointer.currentId },
      });
    const html = renderHtml(
      template.html,
      values,
      `ROI-${mode === "internal" ? "INT" : "EKS"}-2026-CONTOH`,
      await settings(),
      2026,
      { bookNumber: 1, bookYear: Number(values.invoice_date.slice(0, 4)) },
    );
    await writeFile(`examples/roi-${mode}.html`, html);
    await writeFile(`examples/roi-${mode}.pdf`, await pdfBuffer(html));
    const page = await browser.newPage({
      viewport: { width: 1000, height: 1300 },
    });
    await page.setContent(html);
    await page.emulateMedia({ media: "print" });
    await page.screenshot({
      path: `test-results/template-${mode}.png`,
      fullPage: true,
    });
    console.log(
      JSON.stringify({
        mode,
        compatMode: await page.evaluate(() => document.compatMode),
        height: await page
          .locator(".monitor-box")
          .evaluate((el) => el.getBoundingClientRect().bottom),
        width: await page
          .locator(".a4-paper")
          .evaluate((el) => el.getBoundingClientRect().width),
      }),
    );
    await page.close();
  }
} finally {
  await browser?.close();
  await closeBrowser();
  await db.$disconnect();
}
