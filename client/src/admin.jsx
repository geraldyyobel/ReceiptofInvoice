import React, { useState, useEffect } from "react";
import { api, download, date, money } from "./api";
import { Notice, Busy, Modal, Pager, BrandMark } from "./ui";
import { ModeCards } from "./public";
import { FormBuilder } from "./builder";
import { CustomTable } from "./custom";
import { TermsEditor, TemplateEditor, Settings } from "./editors";
import { Notifications, NotificationBell, NotificationSummary } from "./notifications";
const menus = [
  ["dashboard", "⌂", "Ringkasan"],
  ["notifications", "🔔", "Notifikasi"],
  ["data", "▤", "Data Form"],
  ["custom", "▦", "Tabel Kustom"],
  ["terms", "≡", "Editor Ketentuan"],
  ["form", "⑂", "Form Builder"],
  ["template", "▧", "Template Dokumen"],
  ["logs", "◷", "Logs & Backup"],
  ["settings", "⚙", "Settings"],
];
export function AdminApp({ config, refreshConfig }) {
  const [me, setMe] = useState(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [page, setPage] = useState(
      new URLSearchParams(location.search).has("mail_oauth")
        ? "settings"
        : "dashboard",
    ),
    [nav, setNav] = useState(false);
  useEffect(() => {
    api("/auth/me")
      .then(setMe)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);
  async function select(mode) {
    try {
      await api("/admin/mode", { method: "POST", body: { mode } });
      setMe({ ...me, mode });
      setPage("dashboard");
    } catch (e) {
      setError(e.message);
    }
  }
  if (loading) return <Busy />;
  if (!me?.admin) return <Login onLogin={setMe} config={config} />;
  if (!me.mode)
    return (
      <main className="mode-admin">
        <div className="between">
          <span className="brand">
            <BrandMark config={config} />
            Ruang admin
          </span>
          <button
            className="secondary"
            onClick={() =>
              api("/auth/logout", { method: "POST" }).then(() => setMe(null))
            }
          >
            Keluar
          </button>
        </div>
        <span className="eyebrow">PILIH RUANG KERJA</span>
        <h1>Kelola penyerahan invoice.</h1>
        <p>Ketentuan, form, template, dan data terpisah untuk setiap mode.</p>
        <ModeCards admin onSelect={select} />
        <Notice type="error">{error}</Notice>
      </main>
    );
  const active = menus.find((m) => m[0] === page),
    props = {
      key: me.mode + "-" + page,
      mode: me.mode,
      onError: (e) => setError(e.message || e),
      admin: me.admin,
      config,
    };
  return (
    <div
      className="admin-shell"
      style={{
        "--primary": config["tema_" + me.mode],
        "--accent": config["aksen_" + me.mode],
      }}
    >
      <aside className={"sidebar " + (nav ? "open" : "")}>
        <a className="brand" href="/">
          <BrandMark config={config} />
          <span>
            Receipt of Invoice<small>PT BUMI CAHAYA UNGGUL</small>
          </span>
        </a>
        <div className="sidebar-caption">
          RUANG KERJA · {me.mode.toUpperCase()}
        </div>
        <nav>
          {menus
            .filter(
              (m) => m[0] !== "settings" || me.admin.role === "superadmin",
            )
            .map(([id, icon, label]) => (
              <button
                key={id}
                className={page === id ? "selected" : ""}
                onClick={() => {
                  setPage(id);
                  setError("");
                  setNav(false);
                }}
              >
                <span>{icon}</span>
                {label}
                {id === "data" && <span className="small-tag">Master</span>}
              </button>
            ))}
        </nav>
        <div className="sidebar-bottom">
          <a href="/" target="_blank" rel="noreferrer">
            Buka form publik ↗
          </a>
          <div className="avatar-row">
            <span className="avatar">{me.admin.name[0]}</span>
            <div>
              {me.admin.name}
              <small>
                {me.admin.role === "superadmin" ? "Super Admin" : "Admin"}
              </small>
            </div>
          </div>
          <button
            className="ghost"
            onClick={() =>
              api("/auth/logout", { method: "POST" })
                .then(() => setMe(null))
                .catch(props.onError)
            }
          >
            Keluar dari akun
          </button>
        </div>
      </aside>
      <div className="admin-body">
        <header className="admin-header">
          <div className="inline">
            <button
              className="mobile-toggle ghost"
              onClick={() => setNav(!nav)}
              aria-label="Buka menu"
            >
              ☰
            </button>
            <span className="muted">Administrasi /</span>
            <b>{active?.[2]}</b>
          </div>
          <div className="inline">
            <span className="mode-badge">{me.mode}</span>
            <NotificationBell key={me.mode} onOpen={() => { setPage("notifications"); setError(""); }} />
            <button
              className="secondary small"
              onClick={() =>
                select(me.mode === "internal" ? "eksternal" : "internal")
              }
            >
              ⇄ Pindah mode
            </button>
          </div>
        </header>
        <main className="admin-content">
          <div className="page-heading">
            <span className="eyebrow">
              RECEIPT OF INVOICE / {me.mode.toUpperCase()}
            </span>
            <h1>{active?.[2]}</h1>
          </div>
          <Notice type="error">{error}</Notice>
          {page === "dashboard" && <Dashboard {...props} navigate={setPage} />}
          {page === "notifications" && <Notifications {...props} />}
          {page === "data" && <DataForm {...props} />}
          {page === "custom" && <CustomTable {...props} />}
          {page === "terms" && <TermsEditor {...props} />}
          {page === "form" && <FormBuilder {...props} />}
          {page === "template" && <TemplateEditor {...props} />}
          {page === "logs" && <Logs {...props} />}
          {page === "settings" && (
            <Settings {...props} refreshConfig={refreshConfig} />
          )}
        </main>
        <footer className="admin-footer">
          PT Bumi Cahaya Unggul · Data master tersimpan terpisah dari tabel
          kerja.
        </footer>
      </div>
    </div>
  );
}
function Login({ onLogin, config }) {
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <div className="login-screen">
      <section className="login-art">
        <a href="/" className="brand light">
          <BrandMark config={config} />
          {config.nama_perusahaan}
        </a>
        <div>
          <span className="eyebrow">ADMINISTRASI KEUANGAN</span>
          <h1>
            Satu ruang.
            <br />
            Seluruh alur
            <br />
            invoice.
          </h1>
          <p>Pengelolaan dokumen dan data penyerahan tagihan BCU.</p>
        </div>
        <small>Receipt of Invoice · 2026</small>
      </section>
      <main className="login-panel">
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              onLogin(
                await api("/auth/login", {
                  method: "POST",
                  body: { email, password },
                }),
              );
            } catch (e) {
              setError(e.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <span className="eyebrow">AKSES TERBATAS</span>
          <h1>Masuk ke ruang admin</h1>
          <p className="muted">Gunakan akun yang diberikan Super Admin BCU.</p>
          <label>
            Email
            <input
              type="email"
              required
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label>
            Password
            <input
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <Notice type="error">{error}</Notice>
          <button className="full" disabled={busy}>
            {busy ? "Memeriksa…" : "Masuk →"}
          </button>
          <a href="/" className="muted">
            ← Kembali ke form publik
          </a>
        </form>
      </main>
    </div>
  );
}
function Dashboard({ onError, navigate }) {
  const [d, setD] = useState(null);
  useEffect(() => {
    api("/admin/dashboard").then(setD).catch(onError);
  }, []);
  if (!d) return <Busy />;
  return (
    <>
      <div className="stats">
        <div className="stat">
          <span>Seluruh penyerahan</span>
          <strong>{d.total}</strong>
          <small>Data master pada mode aktif</small>
        </div>
        <div className="stat">
          <span>Masuk hari ini</span>
          <strong>{d.today}</strong>
          <small>Submission diterima</small>
        </div>
        <div className="stat">
          <span>Email gagal</span>
          <strong>{d.failed}</strong>
          <small>Periksa Email Log untuk detail</small>
        </div>
      </div>
      <NotificationSummary onOpen={() => navigate("notifications")} />
      <section className="paper">
        <h2>Alur administrasi</h2>
        <div className="process-grid">
          {[
            [
              "01",
              "Data masuk",
              "Periksa penyerahan vendor di database master.",
              "data",
            ],
            [
              "02",
              "Kelola salinan",
              "Sinkronkan ke tabel kustom untuk pekerjaan admin.",
              "custom",
            ],
            [
              "03",
              "Dokumen & pengiriman",
              "Kelola template dan pantau pengiriman email.",
              "template",
            ],
          ].map(([n, title, body, target]) => (
            <button
              className="process"
              key={n}
              onClick={() => navigate(target)}
            >
              <span className="eyebrow">{n}</span>
              <h3>{title}</h3>
              <p>{body}</p>
              <span> Buka →</span>
            </button>
          ))}
        </div>
      </section>
    </>
  );
}
function DataForm({ onError }) {
  const [data, setData] = useState(null),
    [filters, setFilters] = useState({
      year: "current",
      q: "",
      from: "",
      to: "",
      vendor: "",
      status: "",
      sort: "submittedAt",
      dir: "desc",
      page: 1,
    }),
    [detail, setDetail] = useState(null),
    [email, setEmail] = useState(""),
    [message, setMessage] = useState("");
  const query = new URLSearchParams(
    Object.entries(filters).filter(([, v]) => v !== ""),
  );
  useEffect(() => {
    api("/admin/submissions?" + query)
      .then(setData)
      .catch(onError);
  }, [JSON.stringify(filters)]);
  const f = (k, v) =>
    setFilters({ ...filters, [k]: v, page: k === "page" ? v : 1 });
  return (
    <>
      <div className="between section-intro">
        <p>Jawaban asli vendor. Tahun buku mengikuti tanggal invoice; nomor buku terpisah per mode dan tahun. Data master hanya dapat dibaca.</p>
        <div className="button-row">
          {["csv", "xlsx"].map((ext) => (
            <button
              className="secondary"
              key={ext}
              onClick={() =>
                download(
                  "/admin/submissions/export/" + ext + "?" + query,
                  "roi-master." + ext,
                ).catch(onError)
              }
            >
              ↓ {ext.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
      <div className="filterbar">
        <label>Tahun buku
          <select aria-label="Tahun buku data form" value={filters.year} onChange={(e) => f("year", e.target.value)}>
            <option value="current">Tahun berjalan ({data?.currentYear || "…"})</option>
            <option value="all">Semua tahun</option>
            {data?.years.map((y) => <option key={y.year} value={y.year}>{y.year} ({y.count} baris)</option>)}
          </select>
        </label>
        <input
          aria-label="Cari data"
          placeholder="Cari referensi, vendor, email…"
          value={filters.q}
          onChange={(e) => f("q", e.target.value)}
        />
        <input
          aria-label="Filter vendor"
          placeholder="Vendor"
          value={filters.vendor}
          onChange={(e) => f("vendor", e.target.value)}
        />
        <label>
          Diterima mulai
          <input
            type="date"
            value={filters.from}
            onChange={(e) => f("from", e.target.value)}
          />
        </label>
        <label>
          Diterima sampai
          <input
            type="date"
            value={filters.to}
            onChange={(e) => f("to", e.target.value)}
          />
        </label>
        <select
          aria-label="Status"
          value={filters.status}
          onChange={(e) => f("status", e.target.value)}
        >
          <option value="">Semua status</option>
          <option value="diterima">Diterima</option>
        </select>
      </div>
      <section className="paper table-paper">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                {[
                  ["bookNumber", "No. Buku / Tahun"],
                  ["reference", "No. Referensi"],
                  ["vendor", "Vendor"],
                  ["submittedAt", "Waktu selesai"],
                  ["status", "Status"],
                ].map(([k, label]) => (
                  <th key={k}>
                    <button
                      className="table-sort"
                      onClick={() =>
                        setFilters({
                          ...filters,
                          sort: k,
                          dir: filters.dir === "asc" ? "desc" : "asc",
                        })
                      }
                    >
                      {label} ↕
                    </button>
                  </th>
                ))}
                <th>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {data?.rows.map((row, i) => (
                <React.Fragment key={row.id}>
                {filters.year === "all" && (i === 0 || data.rows[i - 1].bookYear !== row.bookYear) && <tr className="book-year-heading"><th colSpan={6}>Pembukuan {row.bookYear}</th></tr>}
                <tr>
                  <td><b>{row.bookNumber ?? "—"}</b><small>Tahun {row.bookYear ?? "—"}</small></td>
                  <td className="reference-cell">{row.reference}</td>
                  <td>
                    <b>{row.vendor}</b>
                    <small>{row.email}</small>
                  </td>
                  <td>{date(row.submittedAt)}</td>
                  <td>
                    <span className="status">{row.status}</span>
                  </td>
                  <td>
                    <button
                      className="secondary small"
                      onClick={() =>
                        api("/admin/submissions/" + row.id)
                          .then((s) => {
                            setDetail(s);
                            setEmail(s.email);
                          })
                          .catch(onError)
                      }
                    >
                      Detail →
                    </button>
                  </td>
                </tr>
                </React.Fragment>
              ))}
            </tbody>
          </table>
          {!data?.rows.length && (
            <div className="empty">
              Belum ada penyerahan yang sesuai filter.
            </div>
          )}
        </div>
        {data && <Pager {...data} onChange={(p) => f("page", p)} />}
      </section>
      {detail && (
        <Modal title={detail.reference} onClose={() => setDetail(null)}>
          <p className="muted">
            Buku: {detail.bookYear} · Nomor buku: {detail.bookNumber}<br />
            Mulai: {date(detail.startedAt)} · Selesai:{" "}
            {date(detail.submittedAt)}
            <br />
            Versi form: {detail.formVersionId}
          </p>
          <dl className="review-list">
            {detail.form.fields
              .filter((f) => detail.values[f.code] !== undefined)
              .map((f) => (
                <div key={f.code}>
                  <dt>{f.label}</dt>
                  <dd>
                    {f.type === "file" ? (
                      <button
                        className="secondary small"
                        onClick={() =>
                          download(
                            "/admin/uploads/" +
                              String(detail.values[f.code]).split(":")[0],
                            "lampiran",
                          ).catch(onError)
                        }
                      >
                        Unduh lampiran
                      </button>
                    ) : (
                      String(detail.values[f.code])
                    )}
                  </dd>
                </div>
              ))}
          </dl>
          <div className="total">
            <span>Total</span>
            <b>
              {detail.values.currency} {money(detail.values.total)}
            </b>
          </div>
          <div className="button-row">
            {["pdf", "html"].map((ext) => (
              <button
                key={ext}
                onClick={() =>
                  download(
                    `/admin/submissions/${detail.id}/document/${ext}`,
                    detail.reference + "." + ext,
                  ).catch(onError)
                }
              >
                Unduh {ext.toUpperCase()}
              </button>
            ))}
          </div>
          <form
            className="inline"
            onSubmit={(e) => {
              e.preventDefault();
              api("/admin/submissions/" + detail.id + "/email", {
                method: "POST",
                body: { email },
              })
                .then((r) => setMessage(r.message))
                .catch(onError);
            }}
          >
            <input
              type="email"
              required
              aria-label="Email kirim ulang"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <button className="secondary">Kirim ulang email</button>
          </form>
          <Notice type="success">{message}</Notice>
        </Modal>
      )}
    </>
  );
}
function Logs({ onError, admin }) {
  const [tab, setTab] = useState("activity"),
    [logs, setLogs] = useState(null),
    [backups, setBackups] = useState([]),
    [q, setQ] = useState(""),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [page, setPage] = useState(1),
    [busy, setBusy] = useState(false),
    [restore, setRestore] = useState(null),
    [confirmText, setConfirmText] = useState(""),
    [info, setInfo] = useState("");
  const query = new URLSearchParams({ q, page, from, to });
  function load() {
    if (tab === "backups")
      api("/admin/backups").then(setBackups).catch(onError);
    else
      api("/admin/logs/" + tab + "?" + query)
        .then(setLogs)
        .catch(onError);
  }
  useEffect(load, [tab, q, page, from, to]);
  async function work(fn) {
    setBusy(true);
    try {
      await fn();
      load();
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="tabs">
        {[
          ["activity", "Activity Log"],
          ["email", "Email Log"],
          ...(admin.role === "superadmin"
            ? [["backups", "Backup & Restore"]]
            : []),
        ].map(([id, label]) => (
          <button
            key={id}
            className={id === tab ? "active" : ""}
            onClick={() => {
              setTab(id);
              setPage(1);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <Notice type="success">{info}</Notice>
      {tab !== "backups" ? (
        <>
          <div className="filterbar">
            <input
              placeholder="Cari log…"
              aria-label="Cari log"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
            />
            <label>
              Dari
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </label>
            <label>
              Sampai
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </label>
            {["csv", "xlsx"].map((ext) => (
              <button
                key={ext}
                className="secondary"
                onClick={() =>
                  download(
                    "/admin/logs/" + tab + "?" + query + "&export=" + ext,
                    "log." + ext,
                  ).catch(onError)
                }
              >
                ↓ {ext.toUpperCase()}
              </button>
            ))}
          </div>
          <div className="paper table-paper">
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    {(tab === "email"
                      ? ["Waktu", "Penerima", "Status", "Alasan"]
                      : ["Waktu", "Aktor", "Aksi", "IP", "Sebelum / Sesudah"]
                    ).map((s) => (
                      <th key={s}>{s}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {logs?.rows.map((r) => (
                    <tr key={r.id}>
                      <td>{date(r.createdAt)}</td>
                      {tab === "email" ? (
                        <>
                          <td>{r.recipient}</td>
                          <td>
                            <span
                              className={
                                "status " +
                                (r.status === "gagal" ? "failed" : "")
                              }
                            >
                              {r.status}
                            </span>
                          </td>
                          <td>{r.error || "—"}</td>
                        </>
                      ) : (
                        <>
                          <td>{r.actor}</td>
                          <td>{r.action}</td>
                          <td>{r.ip}</td>
                          <td>
                            <details>
                              <summary>Detail</summary>
                              <pre>
                                {JSON.stringify(
                                  { sebelum: r.before, sesudah: r.after },
                                  null,
                                  2,
                                )}
                              </pre>
                            </details>
                          </td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {logs && <Pager {...logs} onChange={setPage} />}
          </div>
        </>
      ) : (
        <>
          <Notice>
            Backup berisi dump database dan unggahan, dikompresi lalu
            dienkripsi. Simpan ENCRYPTION_KEY secara terpisah; kunci diperlukan
            untuk pemulihan. Backup mencakup kedua mode.
          </Notice>
          <div className="between">
            <p>
              Terakhir:{" "}
              {backups[0]
                ? date(backups[0].createdAt) + " · " + backups[0].status
                : "Belum ada backup"}
            </p>
            <button
              disabled={busy}
              onClick={() =>
                work(async () => {
                  await api("/admin/backups", { method: "POST", body: {} });
                  setInfo("Backup selesai.");
                })
              }
            >
              {busy ? "Memproses…" : "＋ Backup sekarang"}
            </button>
          </div>
          <div className="paper table-paper">
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Arsip</th>
                    <th>Waktu</th>
                    <th>Status</th>
                    <th>Ukuran</th>
                    <th>Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {backups.map((b) => (
                    <tr key={b.id}>
                      <td>
                        {b.filename}
                        <small>{b.error}</small>
                      </td>
                      <td>{date(b.createdAt)}</td>
                      <td>{b.status}</td>
                      <td>{(b.size / 1024).toFixed(1)} KB</td>
                      <td>
                        <div className="button-row">
                          <button
                            className="secondary small"
                            disabled={b.status !== "selesai" || busy}
                            onClick={() =>
                              download(
                                "/admin/backups/" + b.id + "/download",
                                b.filename,
                              ).catch(onError)
                            }
                          >
                            Unduh
                          </button>
                          <button
                            className="danger small"
                            disabled={b.status !== "selesai" || busy}
                            onClick={() => {
                              if (
                                confirm(
                                  "Langkah 1: pulihkan seluruh database dan unggahan dari arsip ini? Perubahan setelah backup akan diganti.",
                                )
                              )
                                api(
                                  "/admin/backups/" + b.id + "/prepare-restore",
                                  { method: "POST", body: {} },
                                )
                                  .then((r) => {
                                    setRestore({ ...r, id: b.id });
                                    setConfirmText("");
                                  })
                                  .catch(onError);
                            }}
                          >
                            Restore
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
      {restore && (
        <Modal
          title="Konfirmasi pemulihan · Langkah 2"
          onClose={() => setRestore(null)}
        >
          <Notice type="warning">{restore.message}</Notice>
          <p>
            Ketik <b>{restore.phrase}</b>
          </p>
          <input
            aria-label="Frasa konfirmasi restore"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
          />
          <button
            className="danger full"
            disabled={busy || confirmText !== restore.phrase}
            onClick={() =>
              work(async () => {
                await api("/admin/backups/" + restore.id + "/restore", {
                  method: "POST",
                  body: { token: restore.token, confirm: confirmText },
                });
                location.reload();
              })
            }
          >
            Pulihkan seluruh data
          </button>
        </Modal>
      )}
    </>
  );
}
