import React, { useState, useEffect, useRef } from "react";
import { Editor } from "@tinymce/tinymce-react";
import { MailAccounts } from "./mail-accounts";
import { api, download, date } from "./api";
import { Busy, Notice, Modal, Color } from "./ui";
export function TermsEditor({ onError, config }) {
  const [data, setData] = useState(null),
    [html, setHtml] = useState(""),
    [dirty, setDirty] = useState(false),
    [preview, setPreview] = useState(false),
    [previewHtml, setPreviewHtml] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [saveState, setSaveState] = useState("");
  function load() {
    return api("/admin/terms").then((d) => {
      setData(d);
      setHtml(d.term.draft);
      setDirty(false);
    });
  }
  useEffect(() => {
    load().catch(onError);
  }, []);
  useEffect(() => {
    if (!dirty) return;
    const timer = setTimeout(() => {
      setSaveState("Menyimpan draft…");
      api("/admin/terms/draft", { method: "PUT", body: { html } })
        .then(() => setSaveState("Draft tersimpan otomatis"))
        .catch((e) => {
          setSaveState("Draft belum tersimpan");
          onError(e);
        });
    }, 1600);
    return () => clearTimeout(timer);
  }, [html, dirty]);
  async function save(publish) {
    setBusy(true);
    try {
      await api("/admin/terms/version", {
        method: "POST",
        body: { html, publish },
      });
      setMessage(
        publish
          ? "Ketentuan dipublikasikan ke halaman vendor."
          : "Versi ketentuan disimpan.",
      );
      await load();
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }
  if (!data) return <Busy />;
  return (
    <>
      <p className="muted">
        Edit ketentuan mode aktif. Draft tidak tampil ke vendor sampai
        dipublikasikan.
      </p>
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
                  body: { enabled, baseRevision: data.visibility.revision },
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
          onClick={async () => {
            if (preview) {
              setPreview(false);
              return;
            }
            try {
              const r = await api("/admin/terms/preview", {
                method: "POST",
                body: { html },
              });
              setPreviewHtml(r.html);
              setPreview(true);
            } catch (e) {
              onError(e);
            }
          }}
        >
          {preview ? "Kembali ke editor" : "Pratinjau tampilan vendor"}
        </button>
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
          licenseKey={config.tinyLicense || "gpl"}
          tinymceScriptSrc="/vendor/tinymce/tinymce.min.js"
          value={html}
          onEditorChange={(v) => {
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
            plugins:
              "lists advlist link image table code preview searchreplace visualblocks wordcount charmap autoresize",
            toolbar:
              "undo redo | blocks fontfamily fontsize | bold italic underline | forecolor backcolor | alignleft aligncenter alignright alignjustify | lineheight | bullist numlist outdent indent | image table link hr | removeformat code",
            automatic_uploads: true,
            paste_data_images: true,
            image_dimensions: true,
            image_advtab: true,
            file_picker_types: "image",
            images_file_types: "jpg,jpeg,png,webp",
            images_upload_handler: async (blobInfo) => {
              const body = new FormData();
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
            content_style:
              "body{font-family:Arial,sans-serif;font-size:15px;line-height:1.7;color:#24352d;max-width:850px;margin:24px auto;padding:0 24px}img{max-width:100%;height:auto}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:8px}",
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
                onClick={() => {
                  if (confirm("Muat versi ini ke draft?"))
                    api("/admin/terms/rollback/" + v.id, {
                      method: "POST",
                      body: {},
                    })
                      .then((r) => {
                        setHtml(r.html);
                        setDirty(false);
                        setMessage(
                          "Versi dipulihkan ke draft. Publish untuk menayangkan.",
                        );
                      })
                      .catch(onError);
                }}
              >
                Rollback ke draft
              </button>
            </div>
          ))}
        </div>
      </section>
    </>
  );
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
export function TemplateEditor({ onError }) {
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
export function Settings({ onError, refreshConfig }) {
  const [s, setS] = useState(null),
    [accounts, setAccounts] = useState([]),
    [tab, setTab] = useState(
      new URLSearchParams(location.search).has("mail_oauth")
        ? "Email / SMTP"
        : "Umum",
    ),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [testEmail, setTestEmail] = useState(""),
    [account, setAccount] = useState(null);
  function load() {
    return Promise.all([
      api("/admin/settings").then((d) => setS({ ...d, smtp_password: "" })),
      api("/admin/admins").then(setAccounts),
    ]);
  }
  useEffect(() => {
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
  return (
    <>
      <Notice>
        Settings dan akun admin berlaku untuk seluruh aplikasi. Ketentuan, form,
        template, dan data tetap terpisah per mode.
      </Notice>
      <Notice type="success">{message}</Notice>
      <div className="settings-grid">
        <aside className="paper settings-nav">
          {[...settingGroups.map((g) => g[0]), "Tema warna", "Akun admin"].map(
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
          {tab === "Akun admin" ? (
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
                        {a.email} · {a.role} · {a.active ? "Aktif" : "Nonaktif"}
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
              {tab === "Email / SMTP" && (
                <MailAccounts
                  method={s.email_transport}
                  onMethodChange={(v) =>
                    setS((d) => ({ ...d, email_transport: v }))
                  }
                  onConnectedSender={(v) =>
                    setS((d) => ({ ...d, email_pengirim: v }))
                  }
                  onRefresh={load}
                  onError={onError}
                />
              )}
              {group && (
                <div className="form-grid">
                  {group[1]
                    .filter(
                      ([key]) =>
                        !(
                          tab === "Email / SMTP" &&
                          (s.email_transport || "smtp") !== "smtp" &&
                          key.startsWith("smtp_")
                        ),
                    )
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
                            value={s[key] || ""}
                            onChange={(e) => update(key, e.target.value)}
                          />
                        ) : (
                          <input
                            type={type}
                            readOnly={
                              key === "email_pengirim" &&
                              ["gmail", "outlook"].includes(s.email_transport)
                            }
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
                          const u = await api("/admin/uploads", {
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
                <option value="admin">Admin</option>
                <option value="superadmin">Super Admin</option>
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
