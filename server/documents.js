import { chromium } from "playwright";
import { smtpTransport } from "./smtp.js";
import { emailContent } from "./email-template.js";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  db,
  settings,
  renderHtml,
  uploadDir,
  fail,
  audit,
} from "./core.js";
let browser, launching;
export async function closeBrowser() {
  if (browser) await browser.close();
  browser = null;
}
export async function pdfBuffer(html) {
  if (!browser?.isConnected()) {
    launching ||= chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    try {
      browser = await launching;
    } finally {
      launching = null;
    }
  }
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    await context.route("**/*", (route) => route.abort());
    const page = await context.newPage();
    // Only validated, local editor images are embedded. No remote network/file requests.
    html = await replaceImages(html);
    await page.setContent(html, { waitUntil: "load", timeout: 15000 });
    return await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
    });
  } finally {
    await context.close();
  }
}
async function replaceImages(html) {
  const matches = [
    ...html.matchAll(/src="\/uploads\/([a-zA-Z0-9-]+\.(png|jpg|webp))"/g),
  ];
  for (const m of matches) {
    try {
      const bytes = await readFile(path.join(uploadDir, m[1]));
      html = html.replace(
        m[0],
        `src="data:image/${m[2] === "jpg" ? "jpeg" : m[2]};base64,${bytes.toString("base64")}"`,
      );
    } catch {
      html = html.replace(m[0], 'alt="Gambar tidak tersedia"');
    }
  }
  return html;
}
export async function documentFor(sub) {
  const template = await db.templateVersion.findUnique({
    where: { id: sub.templateVersionId },
  });
  if (!template) throw fail("Versi template tidak ditemukan", 404);
  const year = new Intl.DateTimeFormat("en", {
    timeZone: sub.documentSettings.zona_waktu || "Asia/Jakarta",
    year: "numeric",
  }).format(sub.submittedAt);
  return replaceImages(
    renderHtml(
      template.html,
      sub.values,
      sub.reference,
      sub.documentSettings,
      year,
      { bookNumber: sub.bookNumber, bookYear: sub.bookYear },
    ),
  );
}
export async function sendMail({ recipient, sub, req, transport }) {
  const s = await settings();
  let status = "terkirim",
    error = null;
  try {
    const mail = smtpTransport(s, transport);
    const attachments = sub
      ? [
          {
            filename: `${sub.reference}.pdf`,
            content: await pdfBuffer(await documentFor(sub)),
            contentType: "application/pdf",
          },
        ]
      : [];
    const message = {
      from: s.email_pengirim,
      to: recipient,
      ...(sub ? emailContent(s, sub) : {
        subject: "Tes email ROI BCU",
        text: "Konfigurasi pengiriman email ROI BCU berhasil.",
      }),
      attachments,
    };
    await mail.sendMail(message);
  } catch (e) {
    status = "gagal";
    error = String(e.message).slice(0, 1000);
  }
  await db.emailLog.create({
    data: {
      mode: sub?.mode || req.mode || "global",
      submissionId: sub?.id,
      recipient,
      status,
      error,
    },
  });
  await audit(
    req,
    "email." + status,
    null,
    { recipient, submissionId: sub?.id || null },
    sub?.mode || req.mode || "global",
  );
  if (error)
    throw fail(
      "Pengiriman gagal. Periksa konfigurasi SMTP dan Email Log.",
      502,
    );
  return { message: "Dokumen berhasil dikirim ke email." };
}
