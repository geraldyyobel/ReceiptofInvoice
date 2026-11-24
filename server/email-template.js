import { templateData } from "./core.js";
import { renderEmailText } from "../shared/email-placeholders.js";

export function emailContent(s, sub) {
  const year = new Intl.DateTimeFormat("en", {
    timeZone: sub.documentSettings.zona_waktu || "Asia/Jakarta", year: "numeric",
  }).format(sub.submittedAt);
  const data = templateData(sub.values, sub.reference, sub.documentSettings, year, sub);
  const subject = renderEmailText(s.email_subjek, data, { subject: true });
  if (!subject) throw Error("Subjek email kosong setelah placeholder diisi.");
  return { subject, text: renderEmailText(s.email_isi, data) };
}

export function previewEmail(s, mode = "eksternal") {
  const year = Number(new Intl.DateTimeFormat("en", { timeZone: s.zona_waktu || "Asia/Jakarta", year: "numeric" }).format(new Date()));
  return emailContent(s, {
    reference: `ROI-${mode === "internal" ? "INT" : "EKS"}-${year}-000001`, bookNumber: 1, bookYear: year,
    submittedAt: new Date(), documentSettings: s,
    values: {
      received_from: "PT Contoh Vendor", invoice_number: "INV-CONTOH-001",
      invoice_date: `${year}-01-15`, currency: "IDR", amount_nett: 1000000, vat: 110000,
      email_anda: "vendor@example.com", po_number: "PO-CONTOH-001",
      ada_ppn: "Ya", invoice_jasa: "Tidak", legalitas_terkirim: "Belum",
      permintaan_via: "Email",
    },
  });
}
