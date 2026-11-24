import React, { useState, useEffect, useCallback, useRef } from "react";
import { api, download, date, money, modeClient } from "./api";
import { Notice, Busy, Modal, Pager, BrandMark } from "./ui";
import { ModeCards } from "./public";
import { FormBuilder } from "./builder";
import { CustomTable } from "./custom";
import { TermsEditor, TemplateEditor, Settings } from "./editors";
import { Dashboard } from "./dashboard";
import { Notifications, NotificationBell } from "./notifications";
import { adminPaths, adminHref, goAdmin, navigateUrl, useLocation, followLink, queryUpdate, modeFromPath, rememberedMode, rememberMode } from "./navigation";
import { adminMenus, masterReaderRole } from "../../shared/admin-routing";
import { adminEmailDomain, isBcuAdminEmail } from "../../shared/admin-email";
export function AdminApp({ config, refreshConfig }) {
  const route = useLocation();
  const routeMode = modeFromPath(route.pathname);
  const relativePath = route.pathname.replace(/^\/admin\/(internal|eksternal)(?=\/|$)/, "/admin").replace(/\/$/, "");
  const [me, setMe] = useState(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [nav, setNav] = useState(false);
  const visibleMenus = adminMenus.filter(([id]) => me?.admin?.menus?.includes(id));
  const firstWorkspacePage = visibleMenus.find(([id]) => id !== "settings")?.[0];
  const firstPage = visibleMenus[0];
  const page = Object.keys(adminPaths).find((key) => adminPaths[key] === relativePath)
    || (relativePath === "/admin" ? (route.searchParams.has("mail_oauth") ? "settings" : firstPage?.[0] || "dashboard") : null);
  const active = visibleMenus.find(([id]) => id === page);
  const activeMode = routeMode || rememberedMode() || me?.mode || "internal";
  const requestVersion = useRef(0);
  function applySession(session) {
    requestVersion.current++;
    setMe(session);
  }
  const refreshAccess = useCallback(async () => {
    const version = ++requestVersion.current;
    const session = await api("/auth/me");
    if (version === requestVersion.current) setMe(session);
  }, []);
  useEffect(() => {
    if (window.location.href !== route.href) return;
    if (routeMode) rememberMode(routeMode);
    if (page === "settings") {
      navigateUrl(adminPaths.settings + route.search, { replace: true });
    } else if (active && (routeMode || rememberedMode() || me?.mode)) {
      navigateUrl(adminHref(page, Object.fromEntries(route.searchParams), activeMode), { replace: true });
    }
  }, [route.href, page, Boolean(active), me?.mode]);
  useEffect(() => { setError(""); setNav(false); }, [route.pathname]);
  useEffect(() => {
    refreshAccess()
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [refreshAccess]);
  useEffect(() => {
    if (!me?.admin) return;
    const refresh = () => refreshAccess().catch((e) => setError(e.message));
    refresh();
    window.addEventListener("focus", refresh);
    window.addEventListener("roi-menu-access-changed", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener("roi-menu-access-changed", refresh);
    };
  }, [route.pathname, me?.admin?.id, refreshAccess]);
  function select(mode) {
    const usingRequestedPage = !routeMode && active && page !== "settings";
    const destination = usingRequestedPage ? page : firstWorkspacePage;
    if (!destination) return;
    rememberMode(mode);
    goAdmin(destination, usingRequestedPage ? Object.fromEntries(route.searchParams) : {}, mode);
  }
  if (loading) return <Busy />;
  if (!me?.admin) return <Login onLogin={applySession} config={config} />;
  if (!routeMode && active && page !== "settings" && !rememberedMode() && !me.mode)
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
              api("/auth/logout", { method: "POST" })
                .then(() => applySession(null)).catch((e) => setError(e.message))
            }
          >
            Keluar
          </button>
        </div>
        <span className="eyebrow">PILIH RUANG KERJA</span>
        <h1>Kelola penyerahan invoice.</h1>
        <p>Ketentuan, form, template, dan data terpisah untuk setiap mode.</p>
        <ModeCards onSelect={select} />
        <Notice type="error">{error}</Notice>
      </main>
    );
  if (active && page !== "settings" && !routeMode) return <Busy />;
  const props = {
      key: activeMode + "-" + page,
      mode: activeMode,
      onError: (e) => setError(e.message || e),
      admin: me.admin,
      config,
    };
  return (
    <div
      className="admin-shell"
      style={{
        "--primary": config["tema_" + activeMode],
        "--accent": config["aksen_" + activeMode],
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
          RUANG KERJA · {page === "settings" ? "PENGATURAN UMUM" : activeMode.toUpperCase()}
        </div>
        <nav>
          {visibleMenus.map(([id, icon, label]) => (
              <a
                key={id}
                href={adminHref(id, {}, activeMode)}
                aria-current={page === id ? "page" : undefined}
                className={page === id ? "selected" : ""}
                onClick={(e) => {
                  followLink(e);
                  setError("");
                  setNav(false);
                }}
              >
                <span>{icon}</span>
                {label}
                {id === "data" && <span className="small-tag">Master</span>}
              </a>
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
                {me.admin.roleLabel}
              </small>
            </div>
          </div>
          <button
            className="ghost"
            onClick={() =>
              api("/auth/logout", { method: "POST" })
                .then(() => applySession(null))
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
            <span className="mode-badge">{page === "settings" ? "Global" : activeMode}</span>
            {routeMode && me.admin.menus.includes("notifications") && <NotificationBell key={activeMode} onOpen={() => { goAdmin("notifications"); setError(""); }} />}
            {firstWorkspacePage && <button
              className="secondary small"
              onClick={() =>
                select(activeMode === "internal" ? "eksternal" : "internal")
              }
            >
              ⇄ Pindah mode
            </button>}
          </div>
        </header>
        <main className="admin-content">
          <div className="page-heading">
            <span className="eyebrow">
              RECEIPT OF INVOICE / {page === "settings" ? "PENGATURAN UMUM" : activeMode.toUpperCase()}
            </span>
            <h1>{active?.[2] || (page ? "Akses menu dibatasi" : "Halaman tidak ditemukan")}</h1>
          </div>
          <Notice type="error">{error}</Notice>
          {!page && <Notice>Alamat halaman admin tidak ditemukan. {firstPage && <a href={adminHref(firstPage[0], {}, activeMode)} onClick={followLink}>Buka {firstPage[2]}</a>}</Notice>}
          {page && !active && (
            <Notice type="error">
              {page === "settings" ? "Settings hanya dapat dibuka Super Admin."
                : visibleMenus.length ? "Anda tidak memiliki akses ke menu ini."
                  : "Akun Anda belum memiliki akses menu. Hubungi Super Admin."}
            </Notice>
          )}
          {active && page === "dashboard" && <Dashboard {...props} navigate={goAdmin} />}
          {active && page === "notifications" && <Notifications {...props} />}
          {active && page === "data" && <DataForm {...props} />}
          {active && page === "custom" && <CustomTable {...props} />}
          {active && page === "terms" && <TermsEditor {...props} />}
          {active && page === "form" && <FormBuilder {...props} />}
          {active && page === "template" && <TemplateEditor {...props} />}
          {active && page === "logs" && <Logs {...props} />}
          {active && page === "settings" && (
            <Settings {...props} refreshConfig={refreshConfig} refreshAccess={refreshAccess} />
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
    [method, setMethod] = useState("password"),
    [challenge, setChallenge] = useState(""),
    [code, setCode] = useState(""),
    [seconds, setSeconds] = useState(0),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const otp = method === "otp";
  const verify = otp && Boolean(challenge);

  useEffect(() => {
    if (!seconds) return;
    const timer = setTimeout(() => setSeconds((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [seconds]);

  function changeMethod(next) {
    if (next === method) return;
    setMethod(next);
    setChallenge("");
    setCode("");
    setPassword("");
    setError("");
  }

  async function run(action) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function requestOtp() {
    const response = await api("/auth/otp/request", { method: "POST", body: { email } });
    setChallenge(response.challenge);
    setSeconds(response.resendAfter);
    setCode("");
  }

  function submit(event) {
    event.preventDefault();
    if (!isBcuAdminEmail(email)) {
      setError(`Gunakan email BCU @${adminEmailDomain} yang terdaftar sebagai admin.`);
      return;
    }
    run(async () => {
      if (otp && !verify) return requestOtp();
      const session = await api(verify ? "/auth/otp/verify" : "/auth/login", {
        method: "POST",
        body: verify ? { email, challenge, code } : { email, password },
      });
      onLogin(session);
    });
  }

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
        <form onSubmit={submit}>
          <span className="eyebrow">AKSES TERBATAS</span>
          <h1>Masuk ke ruang admin</h1>
          <p className="muted">
            {otp ? "Masuk dengan email BCU. Akun baru mendapat akses baca Data Form Master setelah verifikasi."
              : `Gunakan akun terdaftar dengan alamat @${adminEmailDomain}.`}
          </p>
          <div className="button-row login-methods" role="group" aria-label="Cara masuk">
            <button type="button" disabled={busy} aria-pressed={!otp} className={otp ? "secondary" : ""}
              onClick={() => changeMethod("password")}>Password</button>
            <button type="button" disabled={busy} aria-pressed={otp} className={otp ? "" : "secondary"}
              onClick={() => changeMethod("otp")}>OTP email BCU</button>
          </div>
          <label>
            Email
            <input
              type="email"
              required
              autoComplete="username"
              placeholder={`nama@${adminEmailDomain}`}
              readOnly={verify || busy}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          {!otp && <label>
            Password
            <input
              type="password"
              required
              autoComplete="current-password"
              readOnly={busy}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>}
          {verify && <>
            <Notice>Periksa email BCU di atas untuk kode OTP. Kode berlaku 5 menit.</Notice>
            <label>
              Kode OTP
              <input type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}"
                maxLength={6} required readOnly={busy} value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
            </label>
            <div className="button-row">
              <button type="button" className="ghost small" disabled={busy || seconds > 0}
                onClick={() => run(requestOtp)}>
                {seconds ? `Kirim ulang (${seconds} dtk)` : "Kirim ulang kode"}
              </button>
              <button type="button" className="ghost small" disabled={busy} onClick={() => {
                setChallenge("");
                setCode("");
                setError("");
              }}>Ganti email</button>
            </div>
          </>}
          <Notice type="error">{error}</Notice>
          <button className="full" disabled={busy}>
            {busy ? "Memproses…" : verify ? "Verifikasi dan masuk" : otp ? "Kirim kode OTP" : "Masuk →"}
          </button>
          <a href="/" className="muted">
            ← Kembali ke form publik
          </a>
        </form>
      </main>
    </div>
  );
}
function DataForm({ onError, admin }) {
  const masterReader = admin.role === masterReaderRole;
  const { api, download } = modeClient();
  const route = useLocation();
  const defaults = { year: "current", q: "", from: "", to: "", vendor: "", status: "", sort: "submittedAt", dir: "desc", page: 1, followup: "" };
  const filters = Object.fromEntries(Object.entries(defaults).map(([key, value]) => [key, route.searchParams.get(key) ?? value]));
  filters.page = Math.max(1, Math.min(1000000, Math.floor(Number(filters.page)) || 1));
  const setFilters = (next, options) => queryUpdate(next, options);
  const [data, setData] = useState(null),
    [detail, setDetail] = useState(null),
    [email, setEmail] = useState(""),
    [message, setMessage] = useState("");
  const query = new URLSearchParams(
    Object.entries(filters).filter(([, v]) => v !== ""),
  );
  useEffect(() => {
    let active = true;
    api("/admin/submissions?" + query)
      .then((result) => { if (active) setData(result); })
      .catch((e) => { if (active) onError(e); });
    return () => { active = false; };
  }, [JSON.stringify(filters)]);
  const f = (k, v) =>
    setFilters({ ...filters, [k]: v, page: k === "page" ? v : 1 }, { replace: ["q", "vendor", "from", "to"].includes(k) });
  return (
    <>
      <div className="between section-intro">
        <p>Jawaban asli vendor. Tahun buku mengikuti tanggal invoice; nomor buku terpisah per mode dan tahun. Data master hanya dapat dibaca.</p>
        {!masterReader && <div className="button-row">
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
        </div>}
      </div>
      <div className="filterbar">
        <label>Tahun buku
          <select aria-label="Tahun buku data form" value={filters.year} onChange={(e) => f("year", e.target.value)}>
            <option value="current">Tahun berjalan ({data?.currentYear || "…"})</option>
            <option value="all">Semua tahun</option>
            {/^[0-9]+$/.test(String(filters.year)) && !data?.years.some((y) => String(y.year) === String(filters.year)) && <option value={filters.year}>{filters.year}</option>}
            {data?.years.map((y) => <option key={y.year} value={y.year}>{y.year} ({y.count} baris)</option>)}
          </select>
        </label>
        <label>Tindak lanjut<select aria-label="Filter tindak lanjut" value={filters.followup} onChange={(e) => f("followup", e.target.value)}>
          <option value="">Semua penyerahan</option><option value="legality">Legalitas belum terkirim</option><option value="email">Pengiriman terakhir gagal</option>
        </select></label>
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
                    {f.type === "file" && !masterReader ? (
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
          {!masterReader && <><div className="button-row">
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
          </form></>}
          <Notice type="success">{message}</Notice>
        </Modal>
      )}
    </>
  );
}
function Logs({ onError, admin }) {
  const { api, download } = modeClient();
  const route = useLocation(), requestedTab = route.searchParams.get("tab");
  const tab = ["activity", "email", ...(admin.role === "superadmin" ? ["backups"] : [])].includes(requestedTab) ? requestedTab : "activity";
  const setTab = (value) => queryUpdate({ tab: value });
  const [logs, setLogs] = useState(null),
    [backups, setBackups] = useState([]),
    [q, setQ] = useState(""),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [page, setPage] = useState(1),
    [busy, setBusy] = useState(false),
    [restore, setRestore] = useState(null),
    [confirmText, setConfirmText] = useState(""),
    [info, setInfo] = useState(""),
    [reload, setReload] = useState(0);
  const query = new URLSearchParams({ q, page, from, to });
  useEffect(() => {
    let active = true;
    setLogs(null);
    const backupTab = tab === "backups";
    api(backupTab ? "/admin/backups" : "/admin/logs/" + tab + "?" + query)
      .then((result) => { if (active) { if (backupTab) setBackups(result); else setLogs(result); } })
      .catch((e) => { if (active) onError(e); });
    return () => { active = false; };
  }, [tab, q, page, from, to, reload]);
  async function work(fn) {
    setBusy(true);
    try {
      await fn();
      setReload((n) => n + 1);
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
