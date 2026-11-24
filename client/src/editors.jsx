import React, { useState, useEffect, useRef } from "react";
import { Editor } from "@tinymce/tinymce-react";
import { useLocation, settingsTabs, queryUpdate, navigateUrl } from "./navigation";
import { accessPath, MenuAccessSettings } from "./menu-access";
import { adminRoles } from "../../shared/admin-routing";
import termsContentStyle from "./terms-content.css?raw";
import { api, download, date, modeClient } from "./api";
import { Busy, Notice, Modal, Color, Pager } from "./ui";
export function TermsEditor({ onError, config, mode }) {
  const { api, download } = modeClient();
  const [data, setData] = useState(null),
    [html, setHtml] = useState(""),
    [dirty, setDirty] = useState(false),
    [preview, setPreview] = useState(false),
    [previewHtml, setPreviewHtml] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [saveState, setSaveState] = useState(""),
    [imagePicker, setImagePicker] = useState(false);
  const editorRef = useRef(null), latestHtml = useRef(""), savedHtml = useRef(""),
    manualSave = useRef(false), draftQueue = useRef(Promise.resolve()), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function readyHtml() {
    const editor = editorRef.current;
    if (editor && !editor.removed) {
      const results = await editor.uploadImages();
      if (results.some((r) => !r.status)) throw Error("Gambar belum berhasil diunggah. Coba unggah ulang sebelum menyimpan.");
    }
    const content = editor && !editor.removed ? editor.getContent() : latestHtml.current;
    const doc = new DOMParser().parseFromString(content, "text/html");
    if ([...doc.images].some((img) => !/^\/uploads\/[a-zA-Z0-9-]+\.(png|jpg|webp)$/.test(img.getAttribute("src") || "")))
      throw Error("Gambar belum tersimpan di server. Unggah gambar dari komputer sebelum menyimpan ketentuan.");
    latestHtml.current = content;
    if (mounted.current) setHtml(content);
    return content;
  }
  function load() {
    return api("/admin/terms").then((d) => {
      if (!mounted.current) return;
      setData(d);
      latestHtml.current = savedHtml.current = d.term.draft;
      setHtml(d.term.draft);
      setDirty(false);
    });
  }
  useEffect(() => {
    load().catch(onError);
  }, []);
  useEffect(() => {
    if (!dirty || busy || preview) return;
    const timer = setTimeout(() => {
      draftQueue.current = draftQueue.current.catch(() => {}).then(async () => {
        if (!mounted.current || manualSave.current) return;
        setSaveState("Menyiapkan gambar dan menyimpan draft…");
        const content = await readyHtml();
        if (!mounted.current || manualSave.current) return;
        if (content !== savedHtml.current) {
          await api("/admin/terms/draft", { method: "PUT", body: { html: content, mode } });
          savedHtml.current = content;
        }
        if (mounted.current && !manualSave.current) setSaveState("Draft tersimpan otomatis");
      });
      draftQueue.current.catch((e) => {
        if (mounted.current && !manualSave.current) { setSaveState("Draft belum tersimpan"); onError(e); }
      });
    }, 1600);
    return () => clearTimeout(timer);
  }, [html, dirty, busy, preview]);
  async function save(publish) {
    if (manualSave.current) return;
    manualSave.current = true;
    setBusy(true);
    try {
      setSaveState("Menyiapkan gambar dan menyimpan…");
      await draftQueue.current.catch(() => {});
      if (!mounted.current) return;
      const content = await readyHtml();
      if (!mounted.current) return;
      await api("/admin/terms/version", {
        method: "POST",
        body: { html: content, publish, mode },
      });
      setMessage(
        publish
          ? "Ketentuan dipublikasikan ke halaman vendor."
          : "Versi ketentuan disimpan.",
      );
      await load();
      setSaveState("Draft dan versi tersimpan");
    } catch (e) {
      if (mounted.current) { setSaveState("Belum tersimpan"); onError(e); }
    } finally {
      manualSave.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function rollback(id) {
    if (manualSave.current) return;
    if (!confirm("Muat versi ini ke draft?")) return;
    manualSave.current = true;
    setBusy(true);
    setSaveState("Menunggu penyimpanan dan memulihkan draft…");
    try {
      await draftQueue.current.catch(() => {});
      if (!mounted.current) return;
      const r = await api("/admin/terms/rollback/" + id, { method: "POST", body: { mode } });
      if (!mounted.current) return;
      latestHtml.current = savedHtml.current = r.html;
      setHtml(r.html);
      setData((d) => ({ ...d, term: { ...d.term, draft: r.html } }));
      setDirty(false);
      setPreview(false);
      setPreviewHtml("");
      setMessage("Versi dipulihkan ke draft. Publish untuk menayangkan.");
      setSaveState("Versi dipulihkan ke draft");
    } catch (e) {
      if (mounted.current) { setSaveState("Pemulihan draft gagal"); onError(e); }
    } finally {
      manualSave.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  if (!data) return <Busy />;
  return (
    <>
      <p className="muted">
        Edit ketentuan mode aktif. Draft tidak tampil ke vendor sampai
        dipublikasikan.
      </p>
      <p className="muted">Ukuran huruf menggunakan piksel (px): pilih atau ketik 14px, 18px, dan seterusnya. Blok teks yang ingin diubah. Format lama dengan satuan pt tetap dipertahankan sampai Anda mengubahnya.</p>
      <Notice type="success">{message}</Notice>
      <section className="paper terms-visibility">
        <div>
          <h3>Tampilan ketentuan</h3>
          <p className="muted">
            Berlaku hanya untuk mode aktif. Saat OFF, halaman persetujuan dan
            pertanyaan pemahaman ketentuan dilewati. Isi dan riwayat ketentuan
            tetap tersimpan.
          </p>
        </div>
        <label className="check-label">
          <input
            type="checkbox"
            role="switch"
            aria-label="Tampilkan ketentuan"
            checked={data.visibility.enabled}
            disabled={busy}
            onChange={async (e) => {
              const enabled = e.target.checked;
              setBusy(true);
              try {
                const result = await api("/admin/terms/visibility", {
                  method: "PUT",
                  body: { enabled, baseRevision: data.visibility.revision, mode },
                });
                setData((d) => ({ ...d, visibility: result.visibility }));
                setMessage(
                  enabled
                    ? "Ketentuan ditampilkan kepada pengguna."
                    : "Ketentuan dinonaktifkan. Pengguna langsung masuk ke form.",
                );
              } catch (e) {
                onError(e);
              } finally {
                setBusy(false);
              }
            }}
          />
          <strong>
            {data.visibility.enabled
              ? "ON · Ditampilkan"
              : "OFF · Dinonaktifkan"}
          </strong>
        </label>
      </section>
      <div className="toolbar">
        <button
          className="secondary"
          disabled={busy}
          onClick={async () => {
            if (preview) {
              setPreview(false);
              return;
            }
            manualSave.current = true;
            setBusy(true);
            try {
              await draftQueue.current.catch(() => {});
              if (!mounted.current) return;
              const content = await readyHtml();
              if (!mounted.current) return;
              const r = await api("/admin/terms/preview", {
                method: "POST",
                body: { html: content, mode },
              });
              setPreviewHtml(r.html);
              setPreview(true);
            } catch (e) {
              if (mounted.current) onError(e);
            } finally {
              manualSave.current = false;
              if (mounted.current) setBusy(false);
            }
          }}
        >
          {preview ? "Kembali ke editor" : "Pratinjau tampilan vendor"}
        </button>
        <button className="secondary" disabled={busy || preview} onClick={() => setImagePicker(true)}>Sisipkan gambar tersimpan</button>
        <div className="spacer" />
        <small className="muted">{saveState}</small>
        <button
          className="secondary"
          disabled={busy}
          onClick={() => save(false)}
        >
          Simpan versi
        </button>
        <button disabled={busy} onClick={() => save(true)}>
          Publish ketentuan
        </button>
      </div>
      {preview ? (
        <article
          className="paper rich terms-preview"
          dangerouslySetInnerHTML={{ __html: previewHtml }}
        />
      ) : (
        <Editor
          onInit={(_, editor) => { editorRef.current = editor; }}
          disabled={busy}
          licenseKey={config.tinyLicense || "gpl"}
          tinymceScriptSrc="/vendor/tinymce/tinymce.min.js"
          value={html}
          onEditorChange={(v) => {
            latestHtml.current = v;
            setHtml(v);
            setDirty(true);
          }}
          init={{
            height: 650,
            menubar: "edit view insert format table tools",
            language: "id",
            language_url: "/vendor/roi-id.js",
            base_url: "/vendor/tinymce",
            suffix: ".min",
            promotion: false,
            branding: false,
            relative_urls: false,
            remove_script_host: true,
            plugins:
              "lists advlist link image table code preview searchreplace visualblocks wordcount charmap autoresize",
            toolbar:
              "undo redo | blocks fontfamily fontsizeinput | bold italic underline | forecolor backcolor | alignleft aligncenter alignright alignjustify | lineheight | bullist numlist outdent indent | image table link hr | removeformat code",
            font_size_formats: "8px 10px 11px 12px 14px 15px 16px 17px 18px 20px 22px 24px 28px 32px 36px 48px",
            font_size_input_default_unit: "px",
            body_class: "roi-terms-content",
            automatic_uploads: true,
            paste_data_images: true,
            image_dimensions: true,
            image_advtab: true,
            file_picker_types: "image",
            images_file_types: "jpg,jpeg,png,webp",
            images_upload_handler: async (blobInfo) => {
              const body = new FormData();
              body.append("mode", mode);
              body.append("file", blobInfo.blob(), blobInfo.filename());
              return (await api("/admin/uploads", { method: "POST", body }))
                .location;
            },
            file_picker_callback: (callback) => {
              const input = document.createElement("input");
              input.type = "file";
              input.accept = "image/png,image/jpeg,image/webp";
              input.onchange = async () => {
                try {
                  const body = new FormData();
                  body.append("mode", mode);
                  body.append("file", input.files[0]);
                  const u = await api("/admin/uploads", {
                    method: "POST",
                    body,
                  });
                  callback(u.location, { alt: u.name });
                } catch (e) {
                  onError(e);
                }
              };
              input.click();
            },
            content_style: termsContentStyle,
          }}
        />
      )}
      <section className="paper">
        <h3>Riwayat versi & rollback</h3>
        <p className="muted">
          Rollback memuat versi ke draft. Periksa lalu Publish untuk
          menayangkannya.
        </p>
        <div className="version-list">
          {data.versions.map((v) => (
            <div className="between" key={v.id}>
              <span>
                {date(v.createdAt)} · {v.author}{" "}
                {data.term.publishedId === v.id && (
                  <span className="status">Terpublikasi</span>
                )}
              </span>
              <button
                className="secondary small"
                disabled={busy}
                onClick={() => rollback(v.id)}
              >
                Rollback ke draft
              </button>
            </div>
          ))}
        </div>
      </section>
      {imagePicker && <StoredImages onClose={() => setImagePicker(false)} onInsert={(image) => {
        const editor = editorRef.current;
        if (!editor || editor.removed) return;
        editor.focus();
        editor.insertContent(`<img src="${editor.dom.encode(image.location)}" alt="${editor.dom.encode(image.name)}">`);
        setImagePicker(false);
      }} />}
    </>
  );
}
function StoredImages({ onInsert, onClose }) {
  const { api, download } = modeClient();
  const [data, setData] = useState(null), [page, setPage] = useState(1), [error, setError] = useState(""), [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true; setData(null); setError("");
    api("/admin/images?page=" + page + "&size=12").then((d) => { if (active) setData(d); }).catch((e) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [page, retry]);
  return <Modal title="Gambar tersimpan" onClose={onClose}>
    <p className="muted">Gambar yang pernah diunggah pada mode aktif. Pilih posisi pada editor, lalu sisipkan gambar di sini. Gambar tidak disisipkan otomatis ke ketentuan.</p>
    <Notice type="error">{error}</Notice>
    {error && <button className="secondary" onClick={() => setRetry((n) => n + 1)}>Coba lagi</button>}
    {!data ? !error && <Busy /> : <>
      {!data.rows.length && <p className="empty">Belum ada gambar tersimpan.</p>}
      <div className="stored-images">{data.rows.map((image) => <button className="secondary" key={image.id} onClick={() => onInsert(image)}>
        <img src={image.location} alt="" loading="lazy" /><span>{image.name}</span><small>{date(image.createdAt)}</small><b>Sisipkan</b>
      </button>)}</div>
      <Pager {...data} onChange={setPage} />
    </>}
  </Modal>;
}
const placeholders = [
  "nomor_referensi",
  "nomor_buku",
  "tahun_buku",
  "received_from",
  "invoice_number",
  "invoice_date",
  "currency",
  "amount_nett",
  "vat",
  "nsfp",
  "total",
  "po_number",
  "legalitas_terkirim",
  "legalitas_tanggal",
  "nitku",
  ...Array.from({ length: 4 }, (_, i) => [
    `vendor_${i + 1}_nama`,
    `vendor_${i + 1}_kontak`,
  ]).flat(),
  "tahun",
  "setting.penerima_nama",
  "setting.kode_form",
  "setting.nama_perusahaan",
  "setting.kop",
  "project_number",
  "invoice_jasa",
  "email_bukpot",
  "email_anda",
  "permintaan_via",
];
function EmailPlaceholders({ subject, body, onError }) {
  const [preview, setPreview] = useState(null), [busy, setBusy] = useState(false);
  const generation = useRef(0);
  useEffect(() => {
    generation.current++; setPreview(null);
    return () => { generation.current++; };
  }, [subject, body]);
  return <fieldset className="email-placeholders">
    <legend>Placeholder subjek dan isi email</legend>
    <p>Gunakan kode di bawah pada subjek atau isi email. Klik untuk menyalin.
      Nomor dan tahun buku mengikuti master berdasarkan tanggal invoice. Pengaturan email berlaku untuk kedua mode.</p>
    <p>Contoh subjek: <code>{"Receipt of Invoice — Buku {{nomor_buku}} / {{tahun_buku}}"}</code></p>
    <details><summary>Daftar placeholder email</summary>
      <p>Kode field kustom dari Form Builder juga dapat dipakai. Field yang kosong atau tidak ada menghasilkan teks kosong.</p>
      <div className="placeholder-list">{[
        ...placeholders,
        "format_number total", "format_number amount_nett", "format_number vat",
        "format_date invoice_date 'dd-MM-yyyy'", "format_date legalitas_tanggal 'dd-MM-yyyy'",
      ].map((code) => <button key={code} type="button" className="secondary small" onClick={async () => {
        try { await navigator.clipboard.writeText("{{" + code + "}}"); }
        catch { onError(new Error("Penyalinan tidak tersedia. Pilih dan salin kode placeholder secara manual.")); }
      }}>{"{{" + code + "}}"}</button>)}</div>
    </details>
    <p>Pratinjau menggunakan data contoh: No. Buku 1, PT Contoh Vendor, IDR 1.110.000,00.
      Pratinjau tidak mengirim email atau menyimpan pengaturan. Tes kirim email di bawah hanya menguji koneksi.</p>
    <button type="button" className="secondary" disabled={busy} onClick={async () => {
      const current = ++generation.current;
      setBusy(true); setPreview(null);
      try {
        const result = await api("/admin/settings/preview-email", { method: "POST", body: { email_subjek: subject, email_isi: body } });
        if (generation.current === current) setPreview(result);
      } catch (e) { if (generation.current === current) onError(e); }
      finally { setBusy(false); }
    }}>{busy ? "Memuat pratinjau…" : "Pratinjau email"}</button>
    {preview && <div role="region" aria-label="Pratinjau email" className="email-preview">
      <p><b>Subjek:</b> {preview.subject}</p><b>Isi email:</b><pre>{preview.text}</pre>
    </div>}
  </fieldset>;
}
export function TemplateEditor({ onError }) {
  const { api, download } = modeClient();
  const [data, setData] = useState(null),
    [html, setHtml] = useState(""),
    [preview, setPreview] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [sample, setSample] = useState(
      '{"received_from":"PT Contoh Vendor","amount_nett":1000000,"vat":110000}',
    ),
    [previewError, setPreviewError] = useState("");
  function load() {
    return api("/admin/template").then((d) => {
      setData(d);
      setHtml(d.current.html);
    });
  }
  useEffect(() => {
    load().catch(onError);
  }, []);
  useEffect(() => {
    if (!html) return;
    const controller = { cancelled: false },
      timer = setTimeout(async () => {
        try {
          const r = await api("/admin/template/preview/html", {
              method: "POST",
              body: { html, values: JSON.parse(sample) },
              raw: true,
            }),
            s = await r.text();
          if (!controller.cancelled) {
            setPreview(s);
            setPreviewError("");
          }
        } catch (e) {
          if (!controller.cancelled) setPreviewError(e.message);
        }
      }, 600);
    return () => {
      controller.cancelled = true;
      clearTimeout(timer);
    };
  }, [html, sample]);
  if (!data) return <Busy />;
  return (
    <>
      {data.warning && <Notice type="warning">{data.warning}</Notice>}
      <Notice type="success">{message}</Notice>
      <Notice type="error">{previewError}</Notice>
      <div className="toolbar">
        <select
          aria-label="Riwayat template"
          value=""
          onChange={(e) => {
            const v = data.versions.find((v) => v.id === e.target.value);
            if (v) setHtml(v.html);
          }}
        >
          <option value="">Muat versi sebelumnya…</option>
          {data.versions.map((v) => (
            <option key={v.id} value={v.id}>
              {date(v.createdAt)} · {v.author}
            </option>
          ))}
        </select>
        <div className="spacer" />
        {["html", "pdf"].map((ext) => (
          <button
            key={ext}
            className="secondary"
            onClick={() =>
              download("/admin/template/preview/" + ext, "contoh-roi." + ext, {
                method: "POST",
                body: { html, values: JSON.parse(sample) },
              }).catch(onError)
            }
          >
            ↓ Contoh {ext.toUpperCase()}
          </button>
        ))}
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await api("/admin/template", {
                method: "PUT",
                body: { html, baseVersionId: data.current.id },
              });
              await load();
              setMessage(
                "Versi template baru disimpan. Dokumen historis tetap memakai template saat submit.",
              );
            } catch (e) {
              onError(e);
            } finally {
              setBusy(false);
            }
          }}
        >
          Simpan template
        </button>
      </div>
      <div className="template-grid">
        <section>
          <label>
            Kode HTML
            <textarea
              className="code-editor"
              spellCheck="false"
              value={html}
              onChange={(e) => setHtml(e.target.value)}
            />
          </label>
          <details>
            <summary>Data contoh (JSON)</summary>
            <textarea
              className="code-editor small-editor"
              value={sample}
              onChange={(e) => setSample(e.target.value)}
            />
          </details>
        </section>
        <section className="preview-panel">
          <div className="between">
            <h3>Pratinjau A4</h3>
            <span className="small-tag">HTML / cetak</span>
          </div>
          <iframe title="Pratinjau dokumen ROI" sandbox="" srcDoc={preview} />
        </section>
      </div>
      <section className="paper">
        <h3>Daftar placeholder</h3>
        <p className="muted">
          <code>{"{{nomor_buku}}"}</code> adalah nomor urut buku master per mode dan tahun.
          {" "}<code>{"{{tahun_buku}}"}</code> mengikuti tanggal invoice, terpisah dari
          {" "}<code>{"{{tahun}}"}</code> (tahun penerimaan). Perubahan di Tabel Kustom
          tidak mengubah nilai dokumen. Pratinjau memakai nomor 1 dan tahun invoice
          contoh; keduanya dapat diatur melalui JSON data contoh.
        </p>
        <p>
          <code>{"{{format_date invoice_date 'dd-MM-yyyy'}}"}</code> ·{" "}
          <code>{"{{format_number amount_nett}}"}</code>
        </p>
        <div className="placeholder-list">
          {placeholders.map((p) => (
            <button
              className="secondary small"
              key={p}
              onClick={() =>
                navigator.clipboard
                  .writeText("{{" + p + "}}")
                  .then(() => setMessage("Placeholder disalin."))
                  .catch(onError)
              }
            >
              {"{{" + p + "}}"}
            </button>
          ))}
        </div>
        <p className="muted">
          Opsional tanpa posisi di template awal: project_number, invoice_jasa,
          email_bukpot, email_anda, permintaan_via.
        </p>
      </section>
    </>
  );
}
const settingGroups = [
  [
    "Umum",
    [
      ["nama_aplikasi", "Nama aplikasi"],
      ["nama_perusahaan", "Nama perusahaan"],
      ["logo", "URL logo"],
      ["zona_waktu", "Zona waktu"],
      ["format_nomor", "Format nomor referensi"],
    ],
  ],
  [
    "Dokumen",
    [
      ["penerima_nama", "Nama penerima (Received by)"],
      ["kode_form", "Kode form"],
      ["kop", "Teks kop perusahaan"],
    ],
  ],
  [
    "Email / SMTP",
    [
      ["smtp_host", "Host SMTP"],
      ["smtp_port", "Port", "number"],
      ["smtp_user", "User SMTP"],
      ["smtp_password", "Password SMTP (kosongkan agar tetap)", "password"],
      ["smtp_secure", "TLS langsung / port 465", "checkbox"],
      ["email_pengirim", "Email pengirim", "email"],
      ["email_subjek", "Subjek email"],
      ["email_isi", "Isi email", "textarea"],
    ],
  ],
  [
    "Keamanan",
    [
      ["password_min", "Panjang minimum password", "number"],
      ["session_hours", "Masa session (jam)", "number"],
      ["login_limit", "Percobaan login / 15 menit / IP", "number"],
      ["public_limit", "Submit & unggah / jam / IP", "number"],
      ["email_limit", "Pengiriman email / jam / IP", "number"],
    ],
  ],
  [
    "Backup",
    [
      ["backup_jam", "Backup pertama (zona waktu aplikasi)", "time"],
      ["backup_jam_kedua", "Backup kedua (zona waktu aplikasi)", "time"],
      ["backup_retensi", "Retensi (hari)", "number"],
      ["backup_lokasi", "Subfolder di DATA_DIR"],
    ],
  ],
  ["Unggahan", [["upload_mb", "Batas ukuran (MB)", "number"]]],
];
export function Settings({ onError, refreshConfig, refreshAccess }) {
  const route = useLocation();
  const requestedTab = route.searchParams.get("tab");
  const tab = Object.hasOwn(settingsTabs, requestedTab) ? settingsTabs[requestedTab] : (route.searchParams.has("mail_oauth") ? "Email / SMTP" : "Umum");
  const setTab = (label) => queryUpdate({ tab: Object.keys(settingsTabs).find((key) => settingsTabs[key] === label) });
  const [s, setS] = useState(null),
    [accounts, setAccounts] = useState([]),
    [menuPolicy, setMenuPolicy] = useState(null),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [testEmail, setTestEmail] = useState(""),
    [account, setAccount] = useState(null);
  function load() {
    return Promise.all([
      api("/admin/settings").then((d) => setS({ ...d, smtp_password: "" })),
      api("/admin/admins").then(setAccounts),
      api(accessPath).then(setMenuPolicy),
    ]);
  }
  useEffect(() => {
    if (route.searchParams.has("mail_oauth")) {
      setMessage("Fitur login Google/Outlook telah dihapus. Gunakan konfigurasi SMTP.");
      const clean = new URL(window.location.href);
      clean.pathname = "/admin/settings";
      clean.searchParams.delete("mail_oauth");
      clean.searchParams.set("tab", "email");
      navigateUrl(clean.href, { replace: true });
    }
    load().catch(onError);
  }, []);
  if (!s) return <Busy />;
  function update(k, v) {
    setS({ ...s, [k]: v });
  }
  async function save(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const { smtp_password_set, ...body } = s;
      await api("/admin/settings", { method: "PUT", body });
      setMessage("Pengaturan disimpan.");
      refreshConfig();
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }
  const group = settingGroups.find((g) => g[0] === tab);
  const roleLabels = menuPolicy?.roleLabels || adminRoles;
  return (
    <>
      <Notice>
        Settings dan akun admin berlaku untuk seluruh aplikasi. Ketentuan, form,
        template, dan data tetap terpisah per mode.
      </Notice>
      <Notice type="success">{message}</Notice>
      <div className="settings-grid">
        <aside className="paper settings-nav">
          {Object.values(settingsTabs).map(
            (t) => (
              <button
                className={tab === t ? "selected" : ""}
                key={t}
                onClick={() => setTab(t)}
              >
                {t}
              </button>
            ),
          )}
        </aside>
        <section className="paper">
          <h2>{tab}</h2>
          {tab === "Akses Menu" ? (
            <MenuAccessSettings accounts={accounts} policy={menuPolicy} setPolicy={setMenuPolicy} refreshAccess={refreshAccess} />
          ) : tab === "Akun admin" ? (
            <>
              <button
                onClick={() =>
                  setAccount({
                    name: "",
                    email: "",
                    role: "admin",
                    active: true,
                    password: "",
                  })
                }
              >
                ＋ Tambah admin
              </button>
              <div className="version-list">
                {accounts.map((a) => (
                  <div className="between" key={a.id}>
                    <div>
                      <b>{a.name}</b>
                      <small>
                        {a.email} · {roleLabels[a.role] || a.role} · {a.active ? "Aktif" : "Nonaktif"}
                      </small>
                    </div>
                    <button
                      className="secondary small"
                      onClick={() => setAccount({ ...a, password: "" })}
                    >
                      Edit
                    </button>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <form onSubmit={save}>
              {tab === "Email / SMTP" && <section className="smtp-settings">
                <p>Pengiriman dokumen menggunakan SMTP. Simpan pengaturan sebelum menjalankan tes kirim email.</p>
                <label>Metode pengiriman email<select aria-label="Metode pengiriman email" value={s.email_transport || "smtp"} onChange={(e) => update("email_transport", e.target.value)}>
                  <option value="smtp">SMTP</option><option value="none">Tidak aktif</option>
                </select></label>
              </section>}
              {group && (
                <div className="form-grid">
                  {group[1]
                    .map(([key, label, type = "text"]) => (
                      <label
                        key={key}
                        className={type === "textarea" ? "span-two" : ""}
                      >
                        {label}
                        {type === "checkbox" ? (
                          <input
                            type="checkbox"
                            checked={!!s[key]}
                            onChange={(e) => update(key, e.target.checked)}
                          />
                        ) : type === "textarea" ? (
                          <textarea
                            aria-label={label}
                            value={s[key] || ""}
                            onChange={(e) => update(key, e.target.value)}
                          />
                        ) : (
                          <input
                            aria-label={label}
                            type={type}
                            value={s[key] ?? ""}
                            onChange={(e) =>
                              update(
                                key,
                                type === "number"
                                  ? Number(e.target.value)
                                  : e.target.value,
                              )
                            }
                            autoComplete={
                              type === "password" ? "new-password" : undefined
                            }
                          />
                        )}
                      </label>
                    ))}
                </div>
              )}
              {tab === "Umum" && (
                <>
                  <small>
                    Format wajib memuat {"{MODE}"}, {"{YEAR}"}, {"{SEQ:6}"}.
                    Contoh: ROI-EKS-2026-000001.
                  </small>
                  <label>
                    Unggah logo
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      onChange={async (e) => {
                        try {
                          if (!e.target.files[0]) return;
                          const body = new FormData();
                          body.append("file", e.target.files[0]);
                          const u = await api("/admin/settings/logo", {
                            method: "POST",
                            body,
                          });
                          update("logo", u.location);
                        } catch (e) {
                          onError(e);
                        }
                      }}
                    />
                  </label>
                  {s.logo && (
                    <img
                      className="logo-preview"
                      src={s.logo}
                      alt="Logo perusahaan"
                    />
                  )}
                </>
              )}
              {tab === "Tema warna" && (
                <div className="form-grid">
                  {[
                    ["tema_internal", "Internal · utama"],
                    ["aksen_internal", "Internal · aksen"],
                    ["tema_eksternal", "Eksternal · utama"],
                    ["aksen_eksternal", "Eksternal · aksen"],
                  ].map(([k, label]) => (
                    <Color
                      key={k}
                      label={label}
                      value={s[k]}
                      onChange={(v) => update(k, v || "#18784f")}
                    />
                  ))}
                </div>
              )}
              {tab === "Unggahan" && (
                <fieldset>
                  <legend>Tipe file yang diizinkan</legend>
                  {[
                    "image/png",
                    "image/jpeg",
                    "image/webp",
                    "application/pdf",
                  ].map((m) => (
                    <label className="check-label" key={m}>
                      <input
                        type="checkbox"
                        checked={s.upload_types.includes(m)}
                        onChange={(e) =>
                          update(
                            "upload_types",
                            e.target.checked
                              ? [...s.upload_types, m]
                              : s.upload_types.filter((x) => x !== m),
                          )
                        }
                      />
                      {m}
                    </label>
                  ))}
                </fieldset>
              )}
              {tab === "Email / SMTP" && <EmailPlaceholders subject={s.email_subjek} body={s.email_isi} onError={onError} />}
              {tab === "Email / SMTP" &&
                (s.email_transport || "smtp") === "smtp" && (
                  <small>
                    Password tersimpan:{" "}
                    {s.smtp_password_set
                      ? "Ya, terenkripsi"
                      : "Belum (environment dipakai jika diisi)"}
                    . Simpan pengaturan sebelum menjalankan tes.
                  </small>
                )}
              <div className="form-actions">
                <button disabled={busy}>
                  {busy ? "Menyimpan…" : "Simpan pengaturan"}
                </button>
              </div>
            </form>
          )}
          {tab === "Email / SMTP" && (
            <form
              className="inline"
              onSubmit={async (e) => {
                e.preventDefault();
                try {
                  const r = await api("/admin/settings/test-email", {
                    method: "POST",
                    body: { email: testEmail },
                  });
                  setMessage(r.message);
                } catch (e) {
                  onError(e);
                }
              }}
            >
              <input
                aria-label="Email tes SMTP"
                type="email"
                placeholder="Email tujuan tes"
                required
                value={testEmail}
                onChange={(e) => setTestEmail(e.target.value)}
              />
              <button className="secondary">Tes kirim email</button>
            </form>
          )}
        </section>
      </div>
      {account && (
        <Modal
          title={account.id ? "Edit akun admin" : "Tambah akun admin"}
          onClose={() => setAccount(null)}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await api(
                  "/admin/admins" + (account.id ? "/" + account.id : ""),
                  { method: account.id ? "PUT" : "POST", body: account },
                );
                setAccount(null);
                await load();
                setMessage(
                  "Akun admin disimpan. Session akun yang diubah diakhiri.",
                );
              } catch (e) {
                onError(e);
              }
            }}
          >
            {[
              ["name", "Nama", "text"],
              ["email", "Email", "email"],
              [
                "password",
                account.id
                  ? "Password baru (kosongkan agar tetap)"
                  : "Password",
                "password",
              ],
            ].map(([k, l, t]) => (
              <label key={k}>
                {l}
                <input
                  type={t}
                  required={k !== "password" || !account.id}
                  value={account[k]}
                  onChange={(e) =>
                    setAccount({ ...account, [k]: e.target.value })
                  }
                />
              </label>
            ))}
            <small>
              Password akun maksimal 72 byte UTF-8; karakter beraksen dan emoji
              dapat memakai lebih dari satu byte.
            </small>
            <label>
              Role
              <select
                value={account.role}
                onChange={(e) =>
                  setAccount({ ...account, role: e.target.value })
                }
              >
                {Object.entries(roleLabels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
              </select>
            </label>
            <label className="check-label">
              <input
                type="checkbox"
                checked={account.active}
                onChange={(e) =>
                  setAccount({ ...account, active: e.target.checked })
                }
              />
              Aktif
            </label>
            <button>Simpan akun</button>
          </form>
        </Modal>
      )}
    </>
  );
}
