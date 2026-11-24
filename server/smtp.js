import nodemailer from "nodemailer";
import tls from "node:tls";
import { decrypt } from "./core.js";
import { emailTransport } from "./mail-settings.js";

// Preserve Node's bundled/extra CAs and include the operating system's trusted roots.
const smtpCa = typeof tls.getCACertificates === "function"
  ? [...new Set([...tls.getCACertificates("default"), ...tls.getCACertificates("system")])]
  : undefined;

export function smtpConfigured(s) {
  return emailTransport(s.email_transport) === "smtp" && !!(s.smtp_host || process.env.SMTP_HOST);
}

export function smtpTransport(s, transport) {
  if (emailTransport(s.email_transport) !== "smtp")
    throw Error("Pengiriman email tidak aktif. Isi konfigurasi SMTP dan aktifkan pengiriman di Settings.");
  const host = s.smtp_host || process.env.SMTP_HOST;
  if (!host && !transport) throw Error("SMTP belum dikonfigurasi");
  const user = s.smtp_user || process.env.SMTP_USER;
  return transport || nodemailer.createTransport({
    host,
    port: Number(s.smtp_host ? s.smtp_port : process.env.SMTP_PORT || 587),
    secure: s.smtp_host ? !!s.smtp_secure : process.env.SMTP_SECURE === "true",
    tls: {
      rejectUnauthorized: true,
      ...(smtpCa ? { ca: smtpCa } : {}),
    },
    auth: user ? {
      user,
      pass: s.smtp_password
        ? decrypt(Buffer.from(s.smtp_password, "base64")).toString()
        : process.env.SMTP_PASSWORD,
    } : undefined,
    connectionTimeout: 15000,
    socketTimeout: 30000,
  });
}
