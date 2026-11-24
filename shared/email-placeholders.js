export const publicSettingKeys = [
  "nama_aplikasi", "nama_perusahaan", "kop", "penerima_nama", "kode_form",
  "zona_waktu", "logo",
];

const field = "(?:[a-z][a-zA-Z0-9_]*|setting\\.(?:" + publicSettingKeys.join("|") + "))";
const expression = new RegExp(`^(?:(${field})|format_number\\s+(${field})|format_date\\s+(${field})\\s+'dd-MM-yyyy')$`);
const invalid = () => new Error("Placeholder email tidak valid. Gunakan {{kode_field}}, {{format_number kode_field}} atau {{format_date kode_field 'dd-MM-yyyy'}}; setting hanya mendukung data dokumen publik.");

export function validateEmailTemplate(template) {
  if (typeof template !== "string" || /\{\{\{|\}\}\}/.test(template)) throw invalid();
  const rest = template.replace(/\{\{([\s\S]*?)\}\}/g, (_, code) => {
    const match = expression.exec(code.trim());
    if (!match || ["constructor", "prototype"].includes(match[1] || match[2] || match[3])) throw invalid();
    return "";
  });
  if (rest.includes("{{") || rest.includes("}}")) throw invalid();
  return template;
}

// Replace once: vendor text containing braces is never evaluated as another template.
export function renderEmailText(template, data, { subject = false } = {}) {
  validateEmailTemplate(template);
  let size = 0;
  const rendered = template.replace(/\{\{([\s\S]*?)\}\}/g, (_, code) => {
    const [, plain, number, date] = expression.exec(code.trim());
    const key = plain || number || date;
    const [root, child] = key.split(".");
    let value = Object.hasOwn(data, root) ? data[root] : undefined;
    if (child) value = value && Object.hasOwn(value, child) ? value[child] : undefined;
    if (number) {
      const n = Number(value);
      value = new Intl.NumberFormat("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number.isFinite(n) ? n : 0);
    } else if (date) {
      value = !value || !Number.isFinite(Date.parse(value)) ? "-" : String(value).slice(0, 10).split("-").reverse().join("-");
    } else if (Array.isArray(value)) value = value.join(", ");
    else if (value && typeof value === "object") value = "";
    value = String(value ?? "");
    size += value.length;
    if (size > 100000) throw Error("Hasil placeholder email terlalu panjang.");
    return value;
  });
  if (rendered.length > 110000) throw Error("Hasil placeholder email terlalu panjang.");
  return subject ? rendered.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ").trim() : rendered;
}
