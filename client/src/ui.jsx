import {dateBounds} from "../../shared/date-limits";
import React, { useState } from "react";
export function BrandMark({ config }) {
  return config?.logo ? (
    <img
      className="brand-mark company-logo"
      src={config.logo}
      alt="Logo perusahaan"
    />
  ) : (
    <span className="brand-mark" aria-hidden="true">
      B<span>CU</span>
    </span>
  );
}
export function Notice({ children, type = "info" }) {
  return children ? (
    <div
      className={"notice " + type}
      role={type === "error" ? "alert" : "status"}
    >
      {children}
    </div>
  ) : null;
}
export function Modal({ title, children, onClose }) {
  return (
    <div className="overlay" onClick={onClose}>
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="between">
          <h2>{title}</h2>
          <button className="ghost" aria-label="Tutup" onClick={onClose}>
            ✕
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}
export function Busy({ children = "Memuat…" }) {
  return (
    <p className="loading" role="status">
      {children}
    </p>
  );
}
export function Color({ value, onChange, label = "Warna" }) {
  return (
    <label className="color-control">
      {label}
      <input
        aria-label={label}
        type="color"
        value={value || "#ffffff"}
        onChange={(e) => onChange(e.target.value)}
      />
      <select
        aria-label="Preset warna"
        value=""
        onChange={(e) =>
          e.target.value &&
          onChange(e.target.value === "clear" ? null : e.target.value)
        }
      >
        <option value="">Preset</option>
        <option value="#fff0bb">Kuning</option>
        <option value="#dff1e5">Hijau</option>
        <option value="#dceafb">Biru</option>
        <option value="#fce0de">Merah</option>
        <option value="clear">Hapus warna</option>
      </select>
    </label>
  );
}
export function Pager({ page, total, size = 20, onChange }) {
  return (
    <div className="pager">
      <span>
        {total} baris · Halaman {page} dari{" "}
        {Math.max(1, Math.ceil(total / size))}
      </span>
      <button
        className="secondary"
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
      >
        ← Sebelumnya
      </button>
      <button
        className="secondary"
        disabled={page * size >= total}
        onClick={() => onChange(page + 1)}
      >
        Berikutnya →
      </button>
    </div>
  );
}
export function Field({ field: f, value, onChange, error, timeZone="Asia/Jakarta" }) {
  const bounds=f.type === "date"?dateBounds(f.validation,{timeZone}):{};
  const id = "field-" + f.code,
    props = {
      id,
      value: value ?? "",
      onChange: (e) => onChange(e.target.value),
      required: f.required,
      "aria-invalid": !!error,
      "aria-describedby": id + "-help",
      placeholder: f.placeholder || "",
      disabled: f.active === false,
    };
  return (
    <div className="field">
      <label id={id+'-label'} htmlFor={f.type==='select' && f.presentation==='radio'?undefined:id}>
        {f.label} {f.required && <span className="required">*</span>}
      </label>
      {f.type === 'select' && f.presentation === 'radio' ? (
        <div className="radio-options" role="radiogroup" aria-labelledby={id+'-label'} aria-describedby={id+'-help'} aria-required={f.required}>
          <small id={id+'-help'}>{f.help}</small>
          {f.options.map((o,i)=><label key={o.value}><input id={i===0?id:undefined} type="radio" name={f.code} value={o.value} checked={value===o.value} required={f.required} disabled={f.active===false} onChange={()=>onChange(o.value)}/><span>{o.value}</span></label>)}
        </div>
      ) : f.type === "select" ? (
        <select {...props}>
          <option value="">Pilih jawaban</option>
          {f.options.map((o) => (
            <option key={o.value}>{o.value}</option>
          ))}
        </select>
      ) : f.type === "checkbox" ? (
        <div className="checks">
          {f.options.map((o) => (
            <label key={o.value}>
              <input
                type="checkbox"
                checked={(value || []).includes(o.value)}
                onChange={(e) =>
                  onChange(
                    e.target.checked
                      ? [...(value || []), o.value]
                      : (value || []).filter((v) => v !== o.value),
                  )
                }
              />
              {o.value}
            </label>
          ))}
        </div>
      ) : f.type === "long" ? (
        <textarea {...props} rows={4} />
      ) : f.type === "file" ? (
        <input
          id={id}
          type="file"
          accept="image/png,image/jpeg,image/webp,application/pdf"
          onChange={(e) => onChange(e.target.files[0])}
        />
      ) : (
        <input
          {...props}
          type={["email", "date", "number"].includes(f.type) ? f.type : "text"}
          step={f.type === "number" ? "0.01" : undefined}
          min={f.type === "date" ? bounds.min || undefined : f.type === "number" ? "0" : undefined}
          max={f.type === "date" ? bounds.max || undefined : undefined}
          inputMode={f.type === "number" ? "decimal" : undefined}
        />
      )}
      {!(f.type==='select' && f.presentation==='radio') && <small id={id + "-help"}>
        {f.help}
        {f.type === "date" && (bounds.min || bounds.max) && ` Tanggal yang diperbolehkan: ${bounds.min || "tanpa batas awal"} s.d. ${bounds.max || "tanpa batas akhir"}.`}
        {f.type === "number" && value !== "" && value !== undefined
          ? " · " +
            new Intl.NumberFormat("id-ID", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            }).format(Number(value) || 0)
          : ""}
      </small>}
      {error && <small className="error-text">{error}</small>}
      {f.type === "file" && value && typeof value === "string" && (
        <small>File telah diunggah.</small>
      )}
    </div>
  );
}
