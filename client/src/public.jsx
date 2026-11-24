import React, { useEffect, useMemo, useState } from "react";
import { api, download, money } from "./api";
import { Notice, Field, Busy, BrandMark } from "./ui";
import { ReceiptSearch } from "./receipt-search";
import {
  pathFor,
  validateAnswers,
  amountTotal,
  empty,
  applyAnswer,
} from "../../shared/engine";
export function ModeCards({ onSelect }) {
  return (
    <div className="mode-grid">
      <button
        className="mode-card eksternal"
        onClick={() => onSelect("eksternal")}
      >
        <span className="mode-icon">↗</span>
        <span className="eyebrow">VENDOR & MITRA</span>
        <h2>Eksternal</h2>
        <p>Kelola form dan penyerahan invoice vendor eksternal.</p>
        <span className="card-link">
          Kelola mode <b>→</b>
        </span>
      </button>
      <button
        className="mode-card internal"
        onClick={() => onSelect("internal")}
      >
        <span className="mode-icon">▦</span>
        <span className="eyebrow">LINGKUNGAN BCU</span>
        <h2>Internal</h2>
        <p>Kelola form dan penyerahan invoice internal BCU.</p>
        <span className="card-link">
          Kelola mode <b>→</b>
        </span>
      </button>
    </div>
  );
}
export function PublicApp({ config }) {
  const routeMode =
    /^\/(internal|eksternal)\/?$/.exec(location.pathname)?.[1] || null;
  const [mode, setMode] = useState(routeMode),
    [data, setData] = useState(null),
    [step, setStep] = useState(routeMode ? "loading" : "search"),
    [values, setValues] = useState({}),
    [accepted, setAccepted] = useState(false),
    [startedAt, setStartedAt] = useState(""),
    [cursor, setCursor] = useState(0),
    [errors, setErrors] = useState({}),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [saved, setSaved] = useState(""),
    [email, setEmail] = useState(""),
    [success, setSuccess] = useState(null),
    [storageWarning, setStorageWarning] = useState(""),
    [sent, setSent] = useState("");
  useEffect(() => {
    if (!routeMode) return;
    try {
      const s = JSON.parse(
        sessionStorage.getItem("roi-success-" + routeMode) ||
          sessionStorage.getItem("roi-success"),
      );
      if (s?.mode === routeMode) {
        setSuccess(s);
        setMode(s.mode);
        setEmail(s.email);
        setStep("success");
        return;
      }
    } catch {}
    loadMode(routeMode);
  }, []);
  const loadMode = async (m, fresh = false) => {
    setBusy(true);
    setError("");
    setStorageWarning("");
    setMode(m);
    try {
      const d = await api(`/public/${m}/form`);
      setData(d);
      let draft;
      try {
        if (!fresh) draft = JSON.parse(localStorage.getItem("roi-draft-" + m));
      } catch {}
      const defaults = Object.fromEntries(
        d.form.fields
          .filter((f) => f.defaultValue !== undefined)
          .map((f) => [f.code, f.defaultValue]),
      );
      if (
        draft?.version === d.form.id &&
        Date.parse(draft.startedAt) > Date.now() - 30 * 86400000
      ) {
        setValues(draft.values);
        setStartedAt(draft.startedAt);
      } else {
        setValues(defaults);
        setStartedAt(new Date().toISOString());
      }
      setAccepted(false);
      setCursor(0);
      setStep(d.termsEnabled === false ? "form" : "terms");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const route = useMemo(
    () =>
      data
        ? pathFor(data.form.fields, values, data.form.sections)
        : { visible: [], values: {}, end: null },
    [data, values],
  );
  useEffect(() => {
    if (data && ["form", "review"].includes(step)) {
      try {
        localStorage.setItem(
          "roi-draft-" + mode,
          JSON.stringify({
            version: data.form.id,
            values: route.values,
            startedAt,
          }),
        );
        setSaved("Draft tersimpan di perangkat ini");
      } catch {
        setSaved("Penyimpanan draft browser tidak tersedia");
      }
    }
  }, [values, step]);
  function change(code, value) {
    setValues(
      applyAnswer(data.form.fields, values, code, value, data.form.sections),
    );
    setErrors({});
  }
  async function upload(f, file) {
    if (!file) return;
    setBusy(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const u = await api(`/public/${mode}/upload`, { method: "POST", body });
      change(f.code, u.value);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const field = route.visible[Math.min(cursor, route.visible.length - 1)],
    progress = route.visible.length
      ? Math.round(
          (route.visible.filter((f) => !empty(route.values[f.code])).length /
            route.visible.length) *
            100,
        )
      : 0;
  function next() {
    const check = validateAnswers(data.form.fields, values, data.form.sections, {timeZone:config.zona_waktu});
    if (check.errors[field.code]) {
      setErrors({ [field.code]: check.errors[field.code] });
      return;
    }
    if (route.end?.returnToTerms) {
      setError(route.end.message);
      return;
    }
    if (cursor >= route.visible.length - 1) {
      if (!check.valid) {
        setErrors(check.errors);
        setCursor(route.visible.findIndex((f) => check.errors[f.code]));
        return;
      }
      setStep("review");
    } else setCursor(cursor + 1);
  }
  async function submit() {
    setBusy(true);
    setError("");
    try {
      const s = await api(`/public/${mode}/submit`, {
        method: "POST",
        body: {
          accepted,
          startedAt,
          formVersionId: data.form.id,
          termsVersionId: data.termsVersionId || data.terms.id,
          termsRevision: data.termsRevision ?? 0,
          values: route.values,
        },
      });
      const result = { ...s, mode };
      setSuccess(result);
      setEmail(s.email);
      setStep("success");
      // A successful server insert stays successful even if browser storage is blocked/full.
      for (const persist of [
        () => sessionStorage.setItem("roi-success-" + mode, JSON.stringify(result)),
        () => localStorage.removeItem("roi-draft-" + mode),
      ]) {
        try {
          persist();
        } catch {
          setStorageWarning(
            "Invoice sudah tercatat. Penyimpanan browser tidak tersedia sepenuhnya. Unduh dokumen dan simpan nomor referensi sebelum menutup halaman; jangan kirim ulang invoice ini.",
          );
        }
      }
    } catch (e) {
      setError(e.message);
      if (e.details) setErrors(e.details);
    } finally {
      setBusy(false);
    }
  }
  async function action(fn) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const accent = mode ? config["tema_" + mode] : "#18784f";
  return (
    <div className="public-app" style={{ "--primary": accent }}>
      <header className="public-header">
        <a className="brand" href="/">
          <BrandMark config={config} />
          <span>
            {config.nama_perusahaan}
            <small>PORTAL PENYERAHAN INVOICE</small>
          </span>
        </a>
      </header>
      <main className={"public-main " + (step === "search" ? "receipt-home" : "")}>
        {step === "search" ? (
          <ReceiptSearch />
        ) : (
          <>
            <div className="between">
              <a className="ghost" href="/">
                ← Halaman utama
              </a>
              <span className="mode-badge">{mode}</span>
            </div>
            {step !== "success" && (
              <div className="steps">
                {(data?.termsEnabled === false
                  ? ["Form invoice", "Periksa & kirim"]
                  : ["Ketentuan", "Form invoice", "Periksa & kirim"]
                ).map((s, i) => (
                  <span
                    key={s}
                    className={
                      (data?.termsEnabled === false
                        ? ["form", "review"]
                        : ["terms", "form", "review"]
                      ).indexOf(step) >= i
                        ? "active"
                        : ""
                    }
                  >
                    <b>{i + 1}</b>
                    {s}
                  </span>
                ))}
              </div>
            )}
            {busy && !data && <Busy />}
            {step === "terms" && data?.terms && (
              <>
                <div className="page-heading">
                  <span className="eyebrow">SEBELUM MENGISI</span>
                  <h1>Ketentuan penyerahan</h1>
                  <p>
                    Mohon baca seluruh ketentuan agar dokumen tagihan Anda dapat
                    diproses.
                  </p>
                </div>
                <article
                  className="paper rich"
                  dangerouslySetInnerHTML={{ __html: data.terms.html }}
                />
                <div className="sticky-action">
                  <label className="check-label">
                    <input
                      type="checkbox"
                      checked={accepted}
                      onChange={(e) => setAccepted(e.target.checked)}
                    />
                    Saya telah membaca dan memahami ketentuan
                  </label>
                  <button
                    disabled={!accepted || busy}
                    onClick={() => setStep("form")}
                  >
                    Lanjut ke form →
                  </button>
                </div>
              </>
            )}
            {step === "form" && data && field && (
              <>
                <div className="page-heading">
                  <span className="eyebrow">FORM {mode.toUpperCase()}</span>
                  <h1>Informasi invoice</h1>
                  <p>
                    Isian bertanda <span className="required">*</span> wajib
                    dilengkapi.
                  </p>
                </div>
                <div className="between muted">
                  <span>
                    Pertanyaan {cursor + 1} dari {route.visible.length}
                  </span>
                  <span>{progress}% terisi</span>
                </div>
                <progress
                  max="100"
                  value={progress}
                  aria-label="Kemajuan pengisian"
                />
                <section className="paper question">
                  <span className="eyebrow">
                    {data.form.sections.find((s) => s.id === field.section)
                      ?.label || "Informasi tagihan"}
                  </span>
                  <Field
                    timeZone={config.zona_waktu}
                    key={field.code}
                    field={field}
                    value={values[field.code]}
                    error={errors[field.code]}
                    onChange={(v) =>
                      field.type === "file"
                        ? upload(field, v)
                        : change(field.code, v)
                    }
                  />
                  {route.end && (
                    <Notice type="warning">
                      {route.end.message}
                      {route.end.returnToTerms && (
                        <button
                          className="secondary"
                          onClick={() => {
                            setStep("terms");
                            setAccepted(false);
                          }}
                        >
                          Kembali ke ketentuan
                        </button>
                      )}
                    </Notice>
                  )}
                  <div className="between form-actions">
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() =>
                        cursor
                          ? setCursor(cursor - 1)
                          : data.termsEnabled === false
                            ? location.assign("/")
                            : setStep("terms")
                      }
                    >
                      ← Kembali
                    </button>
                    <button
                      disabled={busy || !!route.end?.returnToTerms}
                      onClick={next}
                    >
                      {cursor === route.visible.length - 1
                        ? "Periksa jawaban"
                        : "Berikutnya"}{" "}
                      →
                    </button>
                  </div>
                </section>
                <div className="between muted">
                  <small>◉ {saved}</small>
                  <button
                    className="ghost"
                    onClick={() => {
                      if (
                        confirm(
                          "Hapus draft pada perangkat ini dan mulai ulang?",
                        )
                      ) {
                        try { localStorage.removeItem("roi-draft-" + mode); } catch {}
                        loadMode(mode, true);
                      }
                    }}
                  >
                    Hapus draft
                  </button>
                </div>
              </>
            )}
            {step === "review" && (
              <>
                <div className="page-heading">
                  <span className="eyebrow">LANGKAH TERAKHIR</span>
                  <h1>Periksa jawaban Anda</h1>
                  <p>
                    Pastikan informasi sesuai dokumen tagihan sebelum dikirim.
                  </p>
                </div>
                <section className="paper">
                  <dl className="review-list">
                    {route.visible.map((f, i) => (
                      <div key={f.code}>
                        <dt>{f.label}</dt>
                        <dd>
                          {f.type === "file"
                            ? "File terunggah"
                            : Array.isArray(values[f.code])
                              ? values[f.code].join(", ")
                              : String(values[f.code] ?? "—")}
                          <button
                            className="ghost"
                            onClick={() => {
                              setCursor(i);
                              setStep("form");
                            }}
                          >
                            Ubah
                          </button>
                        </dd>
                      </div>
                    ))}
                  </dl>
                  <div className="total">
                    <span>Total termasuk VAT</span>
                    <strong>
                      {values.currency}{" "}
                      {money(amountTotal(values.amount_nett, values.vat))}
                    </strong>
                  </div>
                  <div className="between form-actions">
                    <button
                      className="secondary"
                      onClick={() => setStep("form")}
                    >
                      ← Edit jawaban
                    </button>
                    <button disabled={busy} onClick={submit}>
                      {busy ? "Menyimpan…" : "Kirim invoice →"}
                    </button>
                  </div>
                </section>
              </>
            )}
            {step === "success" && success && (
              <>
                <section className="paper success">
                  <div className="success-icon">✓</div>
                  <span className="eyebrow">PENYERAHAN TERCATAT</span>
                  <h1>Receipt of Invoice siap.</h1>
                  <p>Simpan nomor ini untuk mencari dokumen Anda di halaman utama.</p>
                  <div className="reference">{success.reference}</div>
                  {success.bookNumber && success.bookYear && (
                    <p>Nomor buku <strong>{success.bookNumber}</strong> · Tahun buku <strong>{success.bookYear}</strong></p>
                  )}
                  <Notice type="warning">{storageWarning}</Notice>
                  <div className="button-row">
                    <button
                      disabled={busy}
                      onClick={() =>
                        action(() =>
                          download(
                            `/public/submissions/${success.id}/document/pdf`,
                            success.reference + ".pdf",
                            { headers: { "X-Document-Token": success.token } },
                          ),
                        )
                      }
                    >
                      ↓ Unduh PDF
                    </button>
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() =>
                        action(() =>
                          download(
                            `/public/submissions/${success.id}/document/html`,
                            success.reference + ".html",
                            { headers: { "X-Document-Token": success.token } },
                          ),
                        )
                      }
                    >
                      HTML siap cetak
                    </button>
                  </div>
                  <hr />
                  <h3>Kirim dokumen ke email</h3>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      action(async () => {
                        await api(`/public/submissions/${success.id}/email`, {
                          method: "POST",
                          headers: { "X-Document-Token": success.token },
                          body: { email },
                        });
                        setSent("Dokumen berhasil dikirim.");
                      });
                    }}
                    className="inline"
                  >
                    <input
                      aria-label="Alamat email penerima"
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                    <button disabled={busy}>Kirim email</button>
                  </form>
                  <Notice type="success">{sent}</Notice>
                </section>
                <Notice type="warning">
                  Cetak Receipt of Invoice sebanyak 2 (dua) rangkap dan
                  lampirkan bersama dokumen tagihan.
                </Notice>
                <button
                  className="ghost"
                  onClick={() => {
                    for (const key of ["roi-success", "roi-success-" + mode]) {
                      try { sessionStorage.removeItem(key); } catch {}
                    }
                    setSuccess(null);
                    setData(null);
                    setSent("");
                    loadMode(mode, true);
                  }}
                >
                  Isi invoice baru →
                </button>
              </>
            )}
          </>
        )}
        <Notice type="error">{error}</Notice>
      </main>
      <footer className="public-footer">
        <span>© 2026 PT Bumi Cahaya Unggul</span>
        <span>Receipt of Invoice · Administrasi Keuangan</span>
      </footer>
    </div>
  );
}
