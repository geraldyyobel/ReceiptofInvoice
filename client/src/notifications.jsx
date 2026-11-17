import React, { useEffect, useState, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { api, date } from "./api";
import { Modal, Notice, Busy, Pager } from "./ui";
const changed = () => window.dispatchEvent(new Event("roi-notifications-changed"));

export function NotificationSummary({ onOpen }) {
  const [data, setData] = useState(null), [error, setError] = useState("");
  const [page, setPage] = useState(1), [index, setIndex] = useState(0), touch = useRef(null);
  useEffect(() => {
    let active = true, serial = 0;
    setData(null);
    const load = async () => {
      const request = ++serial;
      try {
        const result = await api(`/admin/notifications?box=inbox&page=${page}`);
        if (active && serial === request) {
          setData(result); setError("");
          if (result.page !== page) { setIndex(0); setPage(result.page); }
          else setIndex((i) => Math.min(i, Math.max(0, result.rows.length - 1)));
        }
      } catch (e) { if (active && serial === request) setError(e.message); }
    };
    const refresh = () => { if (!document.hidden) void load(); };
    void load();
    const timer = setInterval(refresh, 15000);
    window.addEventListener("roi-notifications-changed", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      active = false; clearInterval(timer);
      window.removeEventListener("roi-notifications-changed", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [page]);
  const position = data ? (data.page - 1) * data.size + index + 1 : 0;
  function move(delta) {
    if (!data || position + delta < 1 || position + delta > data.total) return;
    if (index + delta < 0) { setPage(page - 1); setIndex(data.size - 1); }
    else if (index + delta >= data.rows.length) { setPage(page + 1); setIndex(0); }
    else setIndex(index + delta);
  }
  const item = data?.rows[index], n = item?.notification;
  return <section className="paper notification-summary" aria-labelledby="notification-summary-title">
    <div className="between">
      <h2 id="notification-summary-title">Notifikasi masuk</h2>
      <button className="secondary small" onClick={onOpen}>Buka kotak masuk →</button>
    </div>
    <Notice type="error">{error}</Notice>
    {!data ? !error && <Busy /> : <>
      {!n ? <p className="empty">Belum ada notifikasi masuk.</p> : <>
        <div className="notification-slider" tabIndex={0} role="region" aria-label="Geser notifikasi" aria-roledescription="karusel"
          onKeyDown={(e) => { if (e.target !== e.currentTarget) return; if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); move(e.key === "ArrowLeft" ? -1 : 1); } }}
          onTouchStart={(e) => { const t = e.touches[0]; touch.current = { x: t.clientX, y: t.clientY }; }}
          onTouchEnd={(e) => { const t = e.changedTouches[0], start = touch.current; touch.current = null; if (start && Math.abs(t.clientX - start.x) > 45 && Math.abs(t.clientX - start.x) > Math.abs(t.clientY - start.y)) move(t.clientX < start.x ? 1 : -1); }}>
          <article className={`notification-item ${!item.readAt ? "notification-unread" : ""}`} aria-live="polite" aria-atomic="true">
            <div className="between"><h3>{n.title}</h3><span className="status">{item.readAt ? "Dibaca" : "Belum dibaca"}</span></div>
            <small className="muted">{n.priority === "urgent" ? "Penting · " : ""}{n.kind === "reminder" ? "Pengingat" : "Informasi"} · {date(n.dueAt)} · {n.authorName}</small>
            <p className="notification-message">{n.message}</p>
          </article>
        </div>
        <div className="between notification-slider-controls">
          <button className="secondary small" aria-label="Notifikasi sebelumnya" disabled={position <= 1} onClick={() => move(-1)}>←</button>
          <small aria-live="polite">{position} dari {data.total} · Geser atau gunakan panah</small>
          <button className="secondary small" aria-label="Notifikasi berikutnya" disabled={position >= data.total} onClick={() => move(1)}>→</button>
        </div>
      </>}
    </>}
  </section>;
}

export function NotificationBell({ onOpen }) {
  const [count, setCount] = useState(0);
  const [open, setOpen] = useState(false), trigger = useRef(null);
  const close = useCallback(() => setOpen(false), []);
  useEffect(() => {
    let active = true, request = 0;
    const load = async () => {
      if (document.hidden) return;
      const serial = ++request;
      try { const d = await api("/admin/notifications/unread"); if (active && serial === request) setCount(d.unread); } catch {}
    };
    void load(); const timer = setInterval(load, 15000);
    window.addEventListener("roi-notifications-changed", load);
    document.addEventListener("visibilitychange", load);
    return () => { active = false; clearInterval(timer); window.removeEventListener("roi-notifications-changed", load); document.removeEventListener("visibilitychange", load); };
  }, []);
  return <><button ref={trigger} className={`secondary small notification-bell ${count ? "has-unread" : ""}`} onClick={() => setOpen(true)} aria-haspopup="dialog" aria-expanded={open} aria-label={`Notifikasi, ${count} belum dibaca`}>
    🔔 Notifikasi <span className="notification-count" aria-live="polite">{count > 99 ? "99+" : count}</span>
  </button>
    {open && <NotificationPopup onClose={close} trigger={trigger} onViewAll={() => { close(); onOpen(); }} />}
  </>;
}
function NotificationPopup({ onClose, onViewAll, trigger }) {
  const [data, setData] = useState(null), [error, setError] = useState(""), [busy, setBusy] = useState(false), [refresh, setRefresh] = useState(0);
  const root = useRef(null);
  useEffect(() => {
    let active = true, serial = 0;
    const load = async () => {
      const request = ++serial;
      try { const d = await api("/admin/notifications?box=inbox&page=1"); if (active && serial === request) { setData(d); setError(""); } }
      catch (e) { if (active && serial === request) setError(e.message); }
    };
    void load(); const timer = setInterval(() => { if (!document.hidden) void load(); }, 15000);
    return () => { active = false; clearInterval(timer); };
  }, [refresh]);
  useEffect(() => {
    root.current?.querySelector("button")?.focus();
    const keyboard = (event) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); }
      if (event.key !== "Tab") return;
      const controls = [...root.current.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]')].filter((el) => el.getClientRects().length);
      const first = controls[0], last = controls.at(-1);
      if (!root.current.contains(document.activeElement)) { event.preventDefault(); (event.shiftKey ? last : first)?.focus(); return; }
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", keyboard);
    return () => { document.removeEventListener("keydown", keyboard); if (trigger.current?.isConnected) trigger.current.focus({ preventScroll: true }); };
  }, [onClose, trigger]);
  async function read(url) {
    setBusy(true); setError("");
    try { await api(url, { method: "POST", body: {} }); changed(); setRefresh((r) => r + 1); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  return createPortal(<div ref={root} className="notification-popup-root"><Modal title="Notifikasi terbaru" onClose={onClose}>
    <Notice type="error">{error}</Notice>
    {!data ? !error && <Busy /> : <>
      <p className="muted">{data.total} notifikasi pada mode aktif · Menampilkan maksimal 5 pesan terbaru.</p>
      <div className="notification-popup-list">
        {!data.rows.length && <p className="empty">Belum ada notifikasi.</p>}
        {data.rows.slice(0, 5).map(({ id, notification: n, readAt }) => <article key={id} className={`notification-item ${!readAt ? "notification-unread" : ""}`}>
          <div className="between"><h3>{n.title}</h3><span className="status">{readAt ? "Dibaca" : "Belum dibaca"}</span></div>
          <small className="muted">{n.priority === "urgent" ? "Penting · " : ""}{n.kind === "reminder" ? "Pengingat" : "Informasi"} · {date(n.dueAt)} · {n.authorName}</small>
          <p className="notification-message">{n.message}</p>
          {!readAt && <button className="secondary small" disabled={busy} onClick={() => read(`/admin/notifications/${n.id}/read`)}>Tandai dibaca</button>}
        </article>)}
      </div>
    </>}
    <div className="button-row notification-popup-actions">
      <button onClick={onViewAll}>Lihat semua notifikasi</button>
      <button className="secondary" disabled={busy || !data?.rows.length} onClick={() => read("/admin/notifications/read-all")}>Tandai semua dibaca</button>
      {error && <button className="secondary" onClick={() => setRefresh((r) => r + 1)}>Coba lagi</button>}
    </div>
  </Modal></div>, document.body);
}
export function Notifications({ admin, onError }) {
  const [box, setBox] = useState("inbox"), [unread, setUnread] = useState(false), [page, setPage] = useState(1),
    [data, setData] = useState(null), [reload, setReload] = useState(0), [compose, setCompose] = useState(false),
    [people, setPeople] = useState([]), [busy, setBusy] = useState(false), [message, setMessage] = useState(""),
    [form, setForm] = useState(null), [formError, setFormError] = useState("");
  useEffect(() => {
    const refresh = () => setReload((value) => value + 1);
    window.addEventListener("roi-notifications-changed", refresh);
    return () => window.removeEventListener("roi-notifications-changed", refresh);
  }, []);
  useEffect(() => {
    let active = true, request = 0;
    const load = () => {
      const serial = ++request;
      return api(`/admin/notifications?box=${box}&unread=${unread ? 1 : 0}&page=${page}`)
        .then((d) => { if (active && serial === request) { setData(d); if (d.page !== page) setPage(d.page); } })
        .catch((e) => { if (active && serial === request) onError(e); });
    };
    void load(); const timer = setInterval(() => { if (!document.hidden) void load(); }, 15000);
    return () => { active = false; clearInterval(timer); };
  }, [box, unread, page, reload]);
  const refresh = () => changed();
  async function act(url) {
    setBusy(true);
    try { await api(url, { method: "POST", body: {} }); refresh(); } catch (e) { onError(e); }
    finally { setBusy(false); }
  }
  async function openCompose() {
    setBusy(true); setFormError("");
    try {
      setPeople(await api("/admin/notifications/recipients"));
      setForm({ title: "", message: "", kind: "info", priority: "normal", all: false, recipients: [admin.id], scheduled: false, localTime: "" });
      setCompose(true);
    } catch (e) { onError(e); } finally { setBusy(false); }
  }
  return <>
    <Notice>Pesan dan pengingat khusus mode aktif. Notifikasi muncul saat waktunya tiba dan tetap tersimpan jika penerima belum membuka aplikasi. Panel memeriksa pembaruan setiap 15 detik. Pengingat ini ditampilkan di aplikasi, tanpa email atau notifikasi sistem laptop.</Notice>
    <Notice type="success">{message}</Notice>
    <div className="toolbar wrap">
      <button disabled={busy} onClick={openCompose}>＋ Buat notifikasi / pengingat</button>
      <button className={box === "inbox" ? "" : "secondary"} onClick={() => { setBox("inbox"); setPage(1); }}>Kotak masuk</button>
      <button className={box === "sent" ? "" : "secondary"} onClick={() => { setBox("sent"); setPage(1); }}>Terkirim / terjadwal</button>
      {box === "inbox" && <><label className="check-label"><input type="checkbox" checked={unread} onChange={(e) => { setUnread(e.target.checked); setPage(1); }} />Belum dibaca saja</label>
        <button className="secondary" disabled={busy} onClick={() => act("/admin/notifications/read-all")}>Tandai semua dibaca</button></>}
    </div>
    {!data || data.box !== box ? <Busy /> : <section className="paper notification-list">
      {!data.rows.length && <p className="empty">Belum ada {box === "sent" ? "pesan terkirim atau terjadwal" : "notifikasi yang sesuai"}.</p>}
      {data.rows.map((item) => {
        const n = box === "sent" ? item : item.notification, read = box === "inbox" && !!item.readAt;
        return <article key={item.id} className={`notification-item ${box === "inbox" && !read ? "notification-unread" : ""}`}>
          <div className="between"><h3>{n.title}</h3><span className="status">{n.canceledAt ? "Dibatalkan" : +new Date(n.dueAt) > Date.now() ? "Terjadwal" : box === "inbox" ? read ? "Dibaca" : "Belum dibaca" : "Terkirim"}</span></div>
          <p className="muted">{n.kind === "reminder" ? "Pengingat" : "Informasi"} · {n.priority === "urgent" ? "Penting · " : ""}{date(n.dueAt)} · Dari {n.authorName}</p>
          <p className="notification-message">{n.message}</p>
          {box === "sent" ? <><small>{n.recipients.filter((r) => r.readAt).length} dari {n.recipients.length} penerima sudah membaca</small>
            {!n.canceledAt && <button className="secondary small" disabled={busy} onClick={() => { if (confirm("Batalkan notifikasi ini untuk seluruh penerima?")) act(`/admin/notifications/${n.id}/cancel`); }}>Batalkan notifikasi</button>}</>
            : !read && <button className="secondary small" disabled={busy} onClick={() => act(`/admin/notifications/${n.id}/read`)}>Tandai dibaca</button>}
        </article>;
      })}
      <Pager {...data} onChange={setPage} />
    </section>}
    {compose && <Modal title="Buat notifikasi / pengingat" onClose={() => !busy && setCompose(false)}>
      <Notice type="error">{formError}</Notice>
      <form className="notification-form" onSubmit={async (e) => {
        e.preventDefault(); setBusy(true); setFormError("");
        try {
          await api("/admin/notifications", { method: "POST", body: { title: form.title, message: form.message, kind: form.kind, priority: form.priority,
            all: form.all, recipients: form.recipients, ...(form.scheduled ? { dueAt: new Date(form.localTime).toISOString() } : {}) } });
          setMessage(form.scheduled ? "Pengingat berhasil dijadwalkan." : "Notifikasi berhasil dibuat."); setCompose(false); refresh();
        } catch (error) { setFormError(error.message); } finally { setBusy(false); }
      }}>
        <label>Judul<input required maxLength={160} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>
        <label>Isi pesan<textarea required rows={4} maxLength={5000} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} /></label>
        <label>Jenis<select aria-label="Jenis notifikasi" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}><option value="info">Informasi</option><option value="reminder">Pengingat</option></select></label>
        <label>Prioritas<select aria-label="Prioritas notifikasi" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}><option value="normal">Biasa</option><option value="urgent">Penting</option></select></label>
        <label className="check-label"><input type="checkbox" checked={form.all} onChange={(e) => setForm({ ...form, all: e.target.checked })} />Semua admin aktif (termasuk Anda)</label>
        {!form.all && <fieldset><legend>Penerima</legend>{people.map((p) => <label key={p.id} className="check-label"><input type="checkbox" checked={form.recipients.includes(p.id)} onChange={(e) => setForm({ ...form, recipients: e.target.checked ? [...form.recipients, p.id] : form.recipients.filter((id) => id !== p.id) })} />{p.name}{p.id === admin.id ? " (Anda)" : ""}</label>)}</fieldset>}
        <label className="check-label"><input type="checkbox" checked={form.scheduled} onChange={(e) => setForm({ ...form, scheduled: e.target.checked })} />Jadwalkan waktu muncul</label>
        {form.scheduled && <label>Waktu pengingat (zona waktu perangkat Anda)<input type="datetime-local" required value={form.localTime} onChange={(e) => setForm({ ...form, localTime: e.target.value })} /></label>}
        <div className="button-row"><button disabled={busy}>{busy ? "Menyimpan…" : "Simpan notifikasi"}</button><button type="button" className="secondary" disabled={busy} onClick={() => setCompose(false)}>Batal</button></div>
      </form>
    </Modal>}
  </>;
}
