import {dateBounds,validateDateLimits} from "./date-limits.js";
export const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const empty = (v) =>
  v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length);
export function condition(rule, values) {
  if (!rule?.conditions?.length) return true;
  const checks = rule.conditions.map((c) => {
    if (c.conditions) return condition(c, values);
    const v = values[c.field];
    switch (c.operator) {
      case "eq":
        return String(v ?? "") === String(c.value ?? "");
      case "neq":
        return String(v ?? "") !== String(c.value ?? "");
      case "contains":
        return Array.isArray(v)
          ? v.includes(c.value)
          : String(v ?? "").includes(String(c.value ?? ""));
      case "empty":
        return empty(v);
      case "filled":
        return !empty(v);
      default:
        return false;
    }
  });
  return rule.join === "OR" ? checks.some(Boolean) : checks.every(Boolean);
}
export function describeRule(rule) {
  return (
    "(" +
    rule.conditions
      .map((c) =>
        c.conditions
          ? describeRule(c)
          : `${c.field} ${c.operator} ${c.value ?? ""}`,
      )
      .join(` ${rule.join} `) +
    ")"
  );
}
export function pathFor(fields, answers = {}, sections = []) {
  const visible = [],
    values = {};
  let end = null;
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i];
    if (f.active === false || !condition(f.showIf, values)) continue;
    visible.push(f);
    if (!empty(answers[f.code])) values[f.code] = answers[f.code];
    const action = f.options?.find(
      (o) => String(o.value) === String(values[f.code]),
    )?.action;
    if (action?.type === "end") {
      end = {
        message: action.message || "Silakan baca kembali ketentuan.",
        returnToTerms: !!action.returnToTerms,
      };
      break;
    }
    if (action?.type === "jump") {
      const targetCode =
        sections.find((s) => s.id === action.target)?.firstField ||
        action.target;
      const index = fields.findIndex((x) => x.code === targetCode);
      if (index <= i) throw Error("Lompatan tidak valid atau membentuk loop");
      i = index - 1;
    }
  }
  return { visible, values, end };
}
export function amountTotal(nett, vat) {
  const cents = (v) => Math.round(Number(v || 0) * 100);
  return (cents(nett) + cents(vat)) / 100;
}
export function applyAnswer(fields, previous, code, value, sections = []) {
  const seen = new Set(
    pathFor(fields, previous, sections).visible.map((f) => f.code),
  );
  let next = { ...previous, [code]: value };
  for (let n = 0; n <= fields.length; n++) {
    const route = pathFor(fields, next, sections);
    next = route.values;
    let added = false;
    for (const f of route.visible) {
      if (!seen.has(f.code) && empty(next[f.code]) && !empty(f.defaultValue)) {
        next[f.code] = Array.isArray(f.defaultValue)
          ? [...f.defaultValue]
          : f.defaultValue;
        added = true;
      }
      seen.add(f.code);
    }
    if (!added) return next;
  }
  return pathFor(fields, next, sections).values;
}
export function validateAnswers(fields, answers, sections = [], dateContext = {}) {
  const result = pathFor(fields, answers, sections),
    errors = {};
  if (result.end?.returnToTerms) errors._form = result.end.message;
  for (const f of result.visible) {
    const v = result.values[f.code];
    if (empty(v)) {
      if (f.required) errors[f.code] = "Wajib diisi";
      continue;
    }
    if (
      f.type === "checkbox"
        ? !Array.isArray(v) || v.some((x) => typeof x !== "string")
        : !["string", "number"].includes(typeof v)
    ) {
      errors[f.code] = "Format nilai tidak valid";
      continue;
    }
    if (String(v).length > 10000) errors[f.code] = "Jawaban terlalu panjang";
    if (f.type === "email" && !EMAIL.test(String(v)))
      errors[f.code] = "Alamat email tidak valid";
    if (f.type === "number") {
      if (!/^\d+(\.\d{1,2})?$/.test(String(v)) || Number(v) > 9999999999999)
        errors[f.code] = "Gunakan angka positif dengan maksimal 2 desimal";
      else result.values[f.code] = Number(v);
    }
    if (
      f.type === "date" &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(String(v)) ||
        !Number.isFinite(Date.parse(v)) ||
        new Date(v).toISOString().slice(0, 10) !== v)
    )
      errors[f.code] = "Tanggal tidak valid";
    if (["select", "checkbox"].includes(f.type)) {
      const opts = f.options.map((x) => x.value);
      if ((Array.isArray(v) ? v : [v]).some((x) => !opts.includes(x)))
        errors[f.code] = "Pilihan tidak valid";
    }
    const r = f.validation || {};
    if(f.type === 'date' && !errors[f.code]) {
      const {min,max}=dateBounds(r,dateContext);
      if(min && v<min)errors[f.code]=`Tanggal paling awal ${min.split('-').reverse().join('-')}`;
      if(max && v>max)errors[f.code]=`Tanggal paling akhir ${max.split('-').reverse().join('-')}`;
    }
    if (
      r.min != null &&
      (f.type === "number" ? Number(v) : String(v).length) < Number(r.min)
    )
      errors[f.code] = `Minimum ${r.min}`;
    if (
      r.max != null &&
      (f.type === "number" ? Number(v) : String(v).length) > Number(r.max)
    )
      errors[f.code] = `Maksimum ${r.max}`;
    if (r.regex && !new RegExp(r.regex, "u").test(String(v)))
      errors[f.code] = "Format tidak sesuai petunjuk";
  }
  return { ...result, errors, valid: !Object.keys(errors).length };
}
export function validateDefinition(fields, sections = []) {
  if (!Array.isArray(fields) || fields.length < 1 || fields.length > 150)
    throw Error("Form harus memiliki 1–150 field");
  const codes = fields.map((f) => f.code);
  if (new Set(codes).size !== codes.length) throw Error("Kode field duplikat");
  if (
    !Array.isArray(sections) ||
    new Set(sections.map((s) => s.id)).size !== sections.length
  )
    throw Error("Section tidak valid/duplikat");
  for (const s of sections)
    if (
      !s.id ||
      !s.label ||
      !codes.includes(s.firstField) ||
      codes.includes(s.id)
    )
      throw Error("Section harus memiliki nama dan field pertama yang valid");
  const supported = [
    "short",
    "long",
    "email",
    "number",
    "date",
    "select",
    "checkbox",
    "file",
  ];
  fields.forEach((f, i) => {
    if (
      !/^[a-z][a-z0-9_]{0,63}$/.test(f.code) ||
      [
        "total",
        "nomor_referensi",
        "nomor_buku",
        "tahun_buku",
        "tahun",
        "setting",
        "__proto__",
        "constructor",
        "prototype",
      ].includes(f.code)
    )
      throw Error("Kode field tidak valid/dicadangkan");
    if (
      typeof f.label !== "string" ||
      !f.label.trim() ||
      f.label.length > 1000 ||
      !supported.includes(f.type) ||
      typeof f.required !== "boolean" ||
      typeof f.active !== "boolean"
    )
      throw Error("Label/tipe/properti field tidak valid");
    if (f.section && !sections.some((s) => s.id === f.section))
      throw Error("Section field tidak ditemukan");
    for (const k of ["help", "placeholder"])
      if (
        f[k] !== undefined &&
        (typeof f[k] !== "string" || f[k].length > 5000)
      )
        throw Error("Teks bantuan/placeholder tidak valid");
    if(f.type === 'date')validateDateLimits(f.validation);
    for (const k of ["min", "max"])
      if (f.validation?.[k] != null && !Number.isFinite(f.validation[k]))
        throw Error("Batas validasi harus angka");
    if (
      f.validation?.min != null &&
      f.validation?.max != null &&
      f.validation.min > f.validation.max
    )
      throw Error("Minimum tidak boleh melebihi maksimum");
    if (
      ["select", "checkbox"].includes(f.type) &&
      (!Array.isArray(f.options) ||
        !f.options.length ||
        new Set(f.options.map((o) => o.value)).size !== f.options.length ||
        f.options.some((o) => typeof o.value !== "string" || !o.value))
    )
      throw Error(`Opsi ${f.code} tidak valid`);
    const rule = f.showIf;
    if (rule) {
      let count = 0;
      const check = (group, depth = 0) => {
        if (
          depth > 5 ||
          !["AND", "OR"].includes(group.join) ||
          !Array.isArray(group.conditions)
        )
          throw Error("Grup kondisi tidak valid atau lebih dari 5 tingkat");
        for (const c of group.conditions) {
          if (++count > 50) throw Error("Maksimum 50 kondisi per field");
          if (c.conditions) {
            check(c, depth + 1);
            continue;
          }
          if (
            !["eq", "neq", "contains", "empty", "filled"].includes(
              c.operator,
            ) ||
            codes.indexOf(c.field) < 0 ||
            codes.indexOf(c.field) >= i
          )
            throw Error(
              `Kondisi ${f.code} harus mengacu pertanyaan sebelumnya`,
            );
        }
      };
      check(rule);
    }
    if (f.validation?.regex) {
      if (f.validation.regex.length > 150) throw Error("Regex terlalu panjang");
      new RegExp(f.validation.regex, "u");
    }
    for (const o of f.options || []) {
      if (o.action && !["next", "jump", "end"].includes(o.action.type))
        throw Error("Aksi percabangan tidak dikenal");
      if (f.type === "checkbox" && o.action && o.action.type !== "next")
        throw Error("Percabangan per opsi hanya untuk pilihan tunggal");
      if (o.action?.type === "jump") {
        const code =
          sections.find((s) => s.id === o.action.target)?.firstField ||
          o.action.target;
        if (codes.indexOf(code) <= i)
          throw Error(
            `Lompatan ${f.code} harus ke field/section sesudahnya; loop dilarang`,
          );
      }
    }
  });
  return true;
}
