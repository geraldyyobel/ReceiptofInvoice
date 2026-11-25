import React, { useEffect, useState, useRef, useMemo } from "react";
import { api, download, modeClient } from "./api";
import { Busy, Modal, Notice, Color, Pager } from "./ui";
import { CustomBackups } from "./custom-backups";
import { indexCells } from "../../shared/table-data";
import { CustomRowPanel } from "./custom-panel";
import { dirtyReview, displayCell } from "../../shared/custom-panel-state";
export function CustomTable({ onError, admin, mode, config }) {
  const { api, download } = useMemo(() => modeClient(mode), [mode]);
  const [panelId, setPanelId] = useState(null), [draftCount, setDraftCount] = useState(0);
  const panelRows = useRef([]), rowElements = useRef(new Map()), tableFallback = useRef(null),
    refreshAfterPanel = useRef(false), historySerial = useRef(0), draftCache = useRef(null);
  const draftKey = `roi:custom-panel:v1:${admin?.id || "admin"}:${mode}`;
  if (!draftCache.current) {
    try { draftCache.current = new Map(JSON.parse(sessionStorage.getItem(draftKey) || "[]")); }
    catch { draftCache.current = new Map(); }
  }
  const [data, setData] = useState(null),
    [selected, setSelected] = useState(null),
    [colForm, setColForm] = useState(null),
    [editCol, setEditCol] = useState(null),
    [message, setMessage] = useState(""),
    [page, setPage] = useState(1),
    [q, setQ] = useState(""),
    [search, setSearch] = useState(""),
    [year, setYear] = useState("current"),
    [loading, setLoading] = useState(false),
    [exporting, setExporting] = useState(false),
    [sort, setSort] = useState(""),
    [dir, setDir] = useState("asc"),
    [drag, setDrag] = useState(null),
    [busy, setBusy] = useState(false),
    [saving, setSaving] = useState(0),
    [syncDialog, setSyncDialog] = useState(false),
    [backupsOpen, setBackupsOpen] = useState(false),
    [confirmSync, setConfirmSync] = useState("");
  const mutationEpoch = useRef(0), pendingWrites = useRef(0),
    requestSerial = useRef(0), queryRef = useRef(""), mounted = useRef(true);
  const query = new URLSearchParams({ page: String(page), size: "50", q: search, year, sort, dir }).toString();
  queryRef.current = query;
  const lookup = useMemo(() => indexCells(data?.cells || []), [data?.cells]);
  function persistPanel(state) {
    draftCache.current.set(state.row.id, state);
    const drafts = [...draftCache.current].filter(([, entry]) => dirtyReview(entry).length || Object.keys(entry.cellDrafts || {}).length);
    try { sessionStorage.setItem(draftKey, JSON.stringify(drafts)); } catch { /* Keep drafts in memory when browser storage is unavailable. */ }
    if (mounted.current) setDraftCount(drafts.length);
  }
  function panelActivity(delta) {
    mutationEpoch.current++; pendingWrites.current += delta;
    if (mounted.current) setSaving((n) => n + delta);
    if (delta < 0 && !pendingWrites.current && refreshAfterPanel.current && mounted.current) {
      refreshAfterPanel.current = false; void load(true);
    }
  }
  async function panelSaved(row) {
    if (!mounted.current) return;
    setData((d) => ({ ...d, rows: d.rows.map((r) => r.id === row.id ? row : r) }));
    const serial = ++historySerial.current;
    try {
      const history = await api("/admin/custom/history");
      if (mounted.current && serial === historySerial.current) setData((d) => ({ ...d, history }));
    } catch { /* A history refresh must not turn a successful save into a failed write. */ }
  }
  function openPanel(row) {
    if (busy || pendingWrites.current) return;
    requestSerial.current++; setLoading(false);
    panelRows.current = [...data.rows]; setPanelId(row.id);
  }
  function closePanel() {
    const element = rowElements.current.get(panelId) || tableFallback.current;
    setPanelId(null); refreshAfterPanel.current = true;
    requestAnimationFrame(() => element?.isConnected ? element.focus({ preventScroll: true }) : tableFallback.current?.focus());
    if (!pendingWrites.current) { refreshAfterPanel.current = false; void load(true); }
  }
  useEffect(() => {
    if (q === search) return;
    const timer = setTimeout(() => { setSearch(q); setPage(1); }, 300);
    return () => clearTimeout(timer);
  }, [q, search]);
  useEffect(() => {
    mounted.current = true;
    setDraftCount([...draftCache.current.values()].filter((entry) => dirtyReview(entry).length || Object.keys(entry.cellDrafts || {}).length).length);
    return () => { mounted.current = false; requestSerial.current++; };
  }, []);
  async function load(silent = false) {
    const serial = ++requestSerial.current, requested = queryRef.current, epoch = mutationEpoch.current;
    if (!silent) setLoading(true);
    try {
      const fresh = await api("/admin/custom?" + requested);
      if (!mounted.current || serial !== requestSerial.current || requested !== queryRef.current || epoch !== mutationEpoch.current) return;
      setData(fresh);
      if (fresh.page !== page) setPage(fresh.page);
    } catch (e) {
      if (e.status === 422 && /Kolom pengurutan/.test(e.message) && sort) {
        setSort(""); setPage(1); return;
      }
      if (!silent && mounted.current && serial === requestSerial.current) onError(e);
    } finally {
      if (mounted.current && serial === requestSerial.current) setLoading(false);
    }
  }
  useEffect(() => { void load(); }, [query]);
  useEffect(() => {
    let fetching = false;
    const timer = setInterval(async () => {
      if (fetching || panelId || busy || syncDialog || backupsOpen || selected || colForm || editCol || document.hidden || pendingWrites.current ||
        document.activeElement?.matches("input,textarea,select,[contenteditable=true]")) return;
      fetching = true;
      try { await load(true); } finally { fetching = false; }
    }, 15000);
    return () => clearInterval(timer);
  }, [panelId, busy, syncDialog, backupsOpen, selected, colForm, editCol, query]);
  async function act(fn) {
    mutationEpoch.current++;
    pendingWrites.current++;
    setBusy(true);
    try { await fn(); await load(); }
    catch (e) { onError(e); }
    finally { mutationEpoch.current++; pendingWrites.current--; setBusy(false); }
  }
  async function navigateHistory(direction) {
    if (
      busy ||
      pendingWrites.current ||
      syncDialog ||
      backupsOpen ||
      selected ||
      colForm ||
      editCol
    )
      return;
    const expectedId = data?.history?.[direction + "Id"];
    if (!expectedId) return;
    await act(async () => {
      try {
        const result = await api("/admin/custom/" + direction, {
          method: "POST",
          body: { expectedId },
        });
        setMessage(
          `${direction === "undo" ? "Dibatalkan" : "Diulangi"}: ${result.label}.`,
        );
      } catch (e) {
        if (e.status === 409) await load();
        throw e;
      }
    });
  }
  useEffect(() => {
    const handler = (e) => {
      if (
        !(e.ctrlKey || e.metaKey) ||
        e.altKey ||
        [...document.querySelectorAll('[role="dialog"]')].some((dialog) => dialog.getClientRects().length) ||
        e.target.closest?.(
          "input,textarea,select,[contenteditable=true],[role=dialog]",
        )
      )
        return;
      const key = e.key.toLowerCase(),
        direction =
          key === "z"
            ? e.shiftKey
              ? "redo"
              : "undo"
            : key === "y"
              ? "redo"
              : null;
      if (!direction) return;
      e.preventDefault();
      void navigateHistory(direction);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    busy,
    saving,
    data?.history,
    syncDialog,
    backupsOpen,
    selected,
    colForm,
    editCol,
  ]);
  if (!data) return <Busy />;
  const cell = (row, col) => lookup.get(row.id)?.get(col.id),
    value = (row, col) => cell(row, col)?.value ?? "";
  const cols = data.columns.filter((c) => !c.hidden), rows = data.rows;
  async function updateCell(row, col, patch) {
    mutationEpoch.current++;
    pendingWrites.current++;
    setSaving((n) => n + 1);
    let moved = false, result;
    try {
      result = await api("/admin/custom/cell", {
        method: "PUT",
        body: { rowId: row.id, columnId: col.id, ...patch },
      });
      const { bookRow, ...savedCell } = result;
      moved = !!bookRow && bookRow.bookYear !== row.bookYear;
      setData((d) => ({
        ...d,
        rows: bookRow ? d.rows.map((r) => r.id === bookRow.id ? bookRow : r) : d.rows,
        cells: [...d.cells.filter((c) => c.id !== result.id), savedCell],
      }));
      if (moved) setMessage("Baris dipindahkan ke pembukuan " + bookRow.bookYear + " dengan nomor " + bookRow.bookNumber + ".");
      const history = await api("/admin/custom/history");
      setData((d) => ({ ...d, history }));
    } finally {
      setSaving((n) => n - 1);
      mutationEpoch.current++;
      pendingWrites.current--;
    }
    if (moved) await load();
    return result;
  }
  function applyView(v) {
    setQ(v.config.q || "");
    setSearch(v.config.q || "");
    setYear(v.config.year || year);
    setSort(v.config.sort || "");
    setDir(v.config.dir || "asc");
    setPage(1);
    act(() =>
      api("/admin/custom/columns/visibility", {
        method: "POST",
        body: { visible: v.config.columns },
      }),
    );
  }
  return (
    <div className="custom-workspace">
      <div className="custom-intro"><p>Salinan kerja invoice. Klik <b>Detail</b> untuk meninjau dan mengedit.</p>
      <details className="custom-help"><summary>Panduan</summary><div>
      <Notice>
        Setiap form masuk otomatis ditambahkan sebagai baris baru. Edit, warna,
        susunan kolom, dan view yang sudah Anda atur tetap disimpan. Halaman
        mengambil 50 baris dan memeriksa pembaruan setiap 15 detik saat Anda tidak sedang mengedit.
        Tahun buku mengikuti tanggal invoice; nomor buku dimulai dari 1 untuk tiap mode dan tahun.
        Jika tanggal invoice tidak tersedia, salinan master memakai tahun penerimaan; baris manual memakai tahun yang dipilih.
        Kolom yang dihapus tidak dibuat ulang; data lengkap tetap tersedia di
        Data Form. Warna XLSX dipertahankan; format CSV tidak mendukung warna.
      </Notice>
      <p className="muted">Undo/Redo menyimpan hingga 50 perubahan per mode. Ctrl+Z, Ctrl+Y atau Ctrl+Shift+Z berlaku saat tidak mengetik. Ekspor mencakup seluruh hasil filter, bukan hanya halaman ini.</p>
      </div></details></div>
      <Notice type="success">{message}</Notice>
      {!!draftCount && <Notice>Ada draf pada {draftCount} baris. Buka kembali detail baris untuk melanjutkan penyimpanan.</Notice>}
      <div className="toolbar wrap">
        <button
          className="secondary"
          disabled={busy || saving > 0}
          onClick={() => setBackupsOpen(true)}
        >
          Backup tabel
        </button>
        <button
          className="secondary"
          aria-label="Undo"
          title={
            data.history?.undoLabel
              ? `Batalkan: ${data.history.undoLabel} (Ctrl+Z)`
              : "Belum ada perubahan"
          }
          disabled={busy || saving > 0 || !data.history?.undoCount}
          onClick={() => navigateHistory("undo")}
        >
          ↶ Undo
        </button>
        <button
          className="secondary"
          aria-label="Redo"
          title={
            data.history?.redoLabel
              ? `Ulangi: ${data.history.redoLabel} (Ctrl+Y / Ctrl+Shift+Z)`
              : "Belum ada perubahan untuk diulangi"
          }
          disabled={busy || saving > 0 || !data.history?.redoCount}
          onClick={() => navigateHistory("redo")}
        >
          ↷ Redo
        </button>

        <button
          className="secondary"
          onClick={() =>
            act(() => api("/admin/custom/rows", { method: "POST", body: { year: data.year || data.currentYear } }))
          }
        >
          ＋ Baris
        </button>
        <button
          className="secondary"
          onClick={() => setColForm({ label: "", type: "short", options: "" })}
        >
          ＋ Kolom
        </button>
        <details className="column-menu">
          <summary>Tampilkan kolom</summary>
          <div className="column-popover">
            {data.columns.map((c) => (
              <label key={c.id} className="check-label">
                <input
                  type="checkbox"
                  checked={!c.hidden}
                  onChange={(e) =>
                    act(() =>
                      api("/admin/custom/columns/" + c.id, {
                        method: "PATCH",
                        body: { hidden: !e.target.checked },
                      }),
                    )
                  }
                />
                {c.label}
              </label>
            ))}
          </div>
        </details>
        <div className="spacer" />
        {["csv", "xlsx"].map((ext) => (
          <button
            key={ext}
            className="secondary"
            disabled={exporting || busy || saving > 0}
            onClick={async () => {
              setExporting(true);
              try { await download("/admin/custom/export/" + ext + "?" + queryRef.current, "tabel-kustom-" + (data.year || "semua-tahun") + "." + ext); }
              catch (e) { onError(e); }
              finally { setExporting(false); }
            }}
          >
            ↓ {ext.toUpperCase()}
          </button>
        ))}
      </div>
      <div className="filterbar">
        <label>Tahun buku
          <select aria-label="Tahun buku tabel kustom" value={year} disabled={busy || saving > 0} onChange={(e) => { setYear(e.target.value); setPage(1); }}>
            <option value="current">Tahun berjalan ({data.currentYear})</option>
            <option value="all">Semua tahun</option>
            {data.years.map((y) => <option key={y.year} value={y.year}>{y.year} ({y.count} baris)</option>)}
          </select>
        </label>
        <select aria-label="Urutan tabel kustom" value={sort} onChange={(e) => { setSort(e.target.value); setPage(1); }}>
          <option value="">Nomor buku</option>
          {data.columns.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
        <select aria-label="Arah urutan tabel kustom" value={dir} onChange={(e) => { setDir(e.target.value); setPage(1); }}>
          <option value="asc">Urutan naik</option>
          <option value="desc">Urutan turun</option>
        </select>
        <input
          placeholder="Cari seluruh sel salinan…"
          aria-label="Cari tabel kustom"
          maxLength={200}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
          }}
        />
        <details className="column-menu custom-view-options"><summary>View tersimpan</summary><div className="column-popover">
        <select
          aria-label="View tersimpan"
          value=""
          onChange={(e) => {
            const v = data.views.find((v) => v.id === e.target.value);
            if (v) applyView(v);
          }}
        >
          <option value="">Pilih view tersimpan…</option>
          {data.views.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
        <button
          className="secondary"
          onClick={() => {
            const name = prompt("Nama view");
            if (name)
              act(() =>
                api("/admin/custom/views", {
                  method: "POST",
                  body: {
                    name,
                    config: { columns: cols.map((c) => c.id), q, sort, dir, year },
                  },
                }),
              );
          }}
        >
          Simpan view
        </button>
        <select
          aria-label="Hapus view"
          value=""
          onChange={(e) => {
            if (e.target.value && confirm("Hapus view ini?"))
              act(() =>
                api("/admin/custom/views/" + e.target.value, {
                  method: "DELETE",
                }),
              );
          }}
        >
          <option value="">Hapus view…</option>
          {data.views.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
        </div></details>
      </div>
      {loading && <Busy>Memuat halaman…</Busy>}
      <section className="paper table-paper" aria-busy={loading} tabIndex={-1} ref={tableFallback}>
        <div className="table-scroll custom-scroll">
          <table className="custom-table">
            <thead>
              <tr>
                <th>No. Buku / Tahun</th>
                {cols.map((c) => (
                  <th
                    key={c.id}
                    draggable
                    onDragStart={() => setDrag(c.id)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => {
                      if (!drag || drag === c.id) return;
                      const a = [...data.columns],
                        from = a.findIndex((x) => x.id === drag),
                        to = a.findIndex((x) => x.id === c.id),
                        item = a.splice(from, 1)[0];
                      a.splice(to, 0, item);
                      act(() =>
                        api("/admin/custom/columns/order", {
                          method: "POST",
                          body: { ids: a.map((c) => c.id) },
                        }),
                      );
                    }}
                    data-column-type={c.type}
                    style={{ background: c.color || undefined }}
                  >
                    <div className="between">
                      <button
                        className="table-sort"
                        title={c.label}
                        onClick={() => {
                          setSort(c.id);
                          setDir(sort === c.id && dir === "asc" ? "desc" : "asc");
                          setPage(1);
                        }}
                      >
                        {c.label} ↕
                      </button>
                      <button
                        className="ghost tiny"
                        aria-label="Pengaturan kolom"
                        onClick={() =>
                          setEditCol({ ...c, options: c.options.join("\n") })
                        }
                      >
                        ⚙
                      </button>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <React.Fragment key={r.id}>
                {year === "all" && (i === 0 || rows[i - 1].bookYear !== r.bookYear) && <tr className="book-year-heading"><th colSpan={cols.length + 1}>Pembukuan {r.bookYear}</th></tr>}
                <tr data-book-year={r.bookYear} data-book-number={r.bookNumber} tabIndex={0}
                  ref={(element) => element ? rowElements.current.set(r.id, element) : rowElements.current.delete(r.id)}
                  className={panelId === r.id ? "custom-row-active" : undefined} aria-selected={panelId === r.id}
                  aria-haspopup="dialog" aria-label={`Buka detail No. Buku ${r.bookNumber} tahun ${r.bookYear}`}
                  onClick={(e) => { if (!e.target.closest("input,textarea,select,button,a,[contenteditable=true]")) openPanel(r); }}
                  onKeyDown={(e) => { if (e.target === e.currentTarget && ["Enter", " "].includes(e.key)) { e.preventDefault(); openPanel(r); } }}>
                  <td>
                    <div className="inline custom-book-actions">
                      <b>{r.bookNumber ?? "—"}</b>
                      <button className="secondary small" onClick={() => openPanel(r)}>Detail →</button>
                      <button
                        className="ghost tiny"
                        aria-label="Warna baris"
                        onClick={() => setSelected({ kind: "row", row: r })}
                      >
                        ◉
                      </button>
                      <button
                        className="ghost tiny"
                        aria-label="Hapus baris"
                        onClick={() => {
                          if (confirm("Hapus baris salinan ini?"))
                            act(() =>
                              api("/admin/custom/rows/" + r.id, {
                                method: "DELETE",
                              }),
                            );
                        }}
                      >
                        ✕
                      </button>
                    </div>
                    <div className="custom-row-meta"><small>Tahun {r.bookYear ?? "—"}</small><small>{r.masterId ? "Salinan master" : "Baris manual"}</small></div>
                  </td>
                  {cols.map((c) => (
                    <td
                      key={c.id}
                      data-column-type={c.type}
                      style={{
                        background:
                          cell(r, c)?.color || r.color || c.color || undefined,
                      }}
                    >
                      <div className="cell-wrap">
                        <span className={c.code === "nomor_referensi" ? "custom-cell-value reference-cell" : "custom-cell-value"} title={displayCell(value(r, c))}>{displayCell(value(r, c))}</span>
                        <button
                          className="cell-color"
                          aria-label="Warna sel"
                          onClick={() =>
                            setSelected({ kind: "cell", row: r, col: c })
                          }
                        >
                          ◉
                        </button>
                      </div>
                    </td>
                  ))}
                </tr>
                </React.Fragment>
              ))}
            </tbody>
          </table>
          {!rows.length && (
            <div className="empty">
              Belum ada data. Form masuk akan muncul otomatis, atau tambahkan
              baris manual.
            </div>
          )}
        </div>
        <Pager
          page={page}
          size={50}
          total={data.total}
          onChange={setPage}
        />
      </section>
      {panelId && <CustomRowPanel key={panelId}
        theme={{ "--primary": config?.["tema_" + mode], "--accent": config?.["aksen_" + mode] }}
        row={data.rows.find((r) => r.id === panelId) || panelRows.current.find((r) => r.id === panelId)}
        cells={data.cells.filter((c) => c.rowId === panelId)} columns={data.columns}
        cached={draftCache.current.get(panelId)} api={api} persist={persistPanel} activity={panelActivity}
        readCached={() => draftCache.current.get(panelId)}
        saved={panelSaved} updateCell={updateCell} CellInput={CellInput} busy={busy}
        history={data.history} travel={navigateHistory} writes={saving}
        canReadMaster={!!admin?.menus?.includes("data")} close={closePanel}
        position={panelRows.current.findIndex((r) => r.id === panelId)} count={panelRows.current.length}
        navigate={(offset) => { const index = panelRows.current.findIndex((r) => r.id === panelId) + offset;
          if (index >= 0 && index < panelRows.current.length) setPanelId(panelRows.current[index].id); }} />}
      <details
        className="paper custom-advanced"
      >
        <summary>Tindakan lanjutan</summary>
        <p className="muted">
          Sinkronisasi berjalan otomatis. Gunakan tindakan manual hanya jika ada
          baris master yang belum tersalin. Sinkronisasi ulang tidak
          mengembalikan nilai lama atau menimpa edit.
        </p>
        <div className="button-row">
          <button
            className="secondary"
            disabled={busy}
            onClick={() => {
              setConfirmSync("");
              setSyncDialog(true);
            }}
          >
            Sinkronisasi ulang
          </button>
          <button
            className="danger"
            onClick={() => {
              const confirm = prompt(
                "Semua edit salinan dan riwayat Undo/Redo pada mode ini akan dihapus. Tindakan ini tidak dapat di-undo. Ketik RESET SALINAN.",
              );
              if (confirm)
                act(() =>
                  api("/admin/custom/reset", {
                    method: "POST",
                    body: { confirm },
                  }),
                );
            }}
          >
            Reset salinan
          </button>
        </div>
      </details>
      {syncDialog && (
        <Modal
          title="Konfirmasi sinkronisasi ulang"
          onClose={() => !busy && setSyncDialog(false)}
        >
          <p>
            Hanya baris master yang belum ada di tabel kustom yang ditambahkan.
            Baris salinan yang pernah dihapus dapat muncul kembali. Edit dan
            warna baris lain tetap disimpan.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (confirmSync !== "SINKRONISASI ULANG" || busy) return;
              act(async () => {
                const result = await api("/admin/custom/sync", {
                  method: "POST",
                  body: { confirm: confirmSync },
                });
                setMessage(`${result.added} baris baru ditambahkan.`);
                setSyncDialog(false);
              });
            }}
          >
            <label>
              Ketik SINKRONISASI ULANG
              <input
                value={confirmSync}
                onChange={(e) => setConfirmSync(e.target.value)}
                autoComplete="off"
                disabled={busy}
              />
            </label>
            <div className="button-row">
              <button disabled={busy || confirmSync !== "SINKRONISASI ULANG"}>
                Jalankan sinkronisasi ulang
              </button>
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => setSyncDialog(false)}
              >
                Batal
              </button>
            </div>
          </form>
        </Modal>
      )}
      {backupsOpen && (
        <Modal
          title="Backup Tabel Kustom"
          onClose={() => setBackupsOpen(false)}
        >
          <CustomBackups />
        </Modal>
      )}
      {colForm && (
        <Modal title="Tambah kolom kustom" onClose={() => setColForm(null)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              act(async () => {
                await api("/admin/custom/columns", {
                  method: "POST",
                  body: {
                    ...colForm,
                    options: colForm.options.split("\n").filter(Boolean),
                  },
                });
                setColForm(null);
              });
            }}
          >
            <label>
              Nama kolom
              <input
                required
                value={colForm.label}
                onChange={(e) =>
                  setColForm({ ...colForm, label: e.target.value })
                }
              />
            </label>
            <label>
              Tipe
              <select
                value={colForm.type}
                onChange={(e) =>
                  setColForm({ ...colForm, type: e.target.value })
                }
              >
                {[
                  ["short", "Teks"],
                  ["number", "Angka"],
                  ["date", "Tanggal"],
                  ["select", "Dropdown"],
                  ["checkbox", "Checkbox"],
                ].map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            {colForm.type === "select" && (
              <label>
                Opsi (satu per baris)
                <textarea
                  value={colForm.options}
                  onChange={(e) =>
                    setColForm({ ...colForm, options: e.target.value })
                  }
                />
              </label>
            )}
            <button>Simpan kolom</button>
          </form>
        </Modal>
      )}
      {editCol && (
        <Modal title="Pengaturan kolom" onClose={() => setEditCol(null)}>
          <label>
            Nama kolom
            <input
              value={editCol.label}
              onChange={(e) =>
                setEditCol({ ...editCol, label: e.target.value })
              }
            />
          </label>
          {editCol.type === "select" && (
            <label>
              Opsi
              <textarea
                value={editCol.options}
                onChange={(e) =>
                  setEditCol({ ...editCol, options: e.target.value })
                }
              />
            </label>
          )}
          <Color
            value={editCol.color}
            onChange={(color) => setEditCol({ ...editCol, color })}
          />
          <div className="button-row">
            <button
              onClick={() =>
                act(async () => {
                  await api("/admin/custom/columns/" + editCol.id, {
                    method: "PATCH",
                    body: {
                      label: editCol.label,
                      color: editCol.color,
                      options: editCol.options.split("\n").filter(Boolean),
                    },
                  });
                  setEditCol(null);
                })
              }
            >
              Simpan
            </button>
            <button
              className="danger"
              onClick={() => {
                if (confirm("Hapus kolom dan semua sel di kolom ini?"))
                  act(async () => {
                    await api("/admin/custom/columns/" + editCol.id, {
                      method: "DELETE",
                    });
                    setEditCol(null);
                  });
              }}
            >
              Hapus kolom
            </button>
          </div>
        </Modal>
      )}
      {selected && (
        <Modal
          title={"Warna " + (selected.kind === "row" ? "baris" : "sel")}
          onClose={() => setSelected(null)}
        >
          <Color
            value={
              selected.kind === "row"
                ? selected.row.color
                : cell(selected.row, selected.col)?.color
            }
            onChange={(color) =>
              act(async () => {
                if (selected.kind === "row")
                  await api("/admin/custom/rows/" + selected.row.id, {
                    method: "PATCH",
                    body: { color },
                  });
                else await updateCell(selected.row, selected.col, { color });
                setSelected(null);
              })
            }
          />
        </Modal>
      )}
    </div>
  );
}
function CellInput({ column: c, initial, onSave, draft, onDraft, disabled = false }) {
  const [local, setLocal] = useState(initial);
  const v = onDraft ? draft : local;
  const setV = onDraft || setLocal;
  if (c.type === "checkbox")
    return (
      <input
        aria-label={c.label}
        type="checkbox"
        disabled={disabled}
        checked={v === true || v === "true"}
        onChange={(e) => {
          setV(e.target.checked);
          onSave(e.target.checked);
        }}
      />
    );
  if (c.type === "select")
    return (
      <select
        aria-label={c.label}
        disabled={disabled}
        value={v}
        onChange={(e) => {
          setV(e.target.value);
          onSave(e.target.value);
        }}
      >
        <option value="" />
        {v !== "" && !c.options.includes(v) && (
          <option value={v}>{String(v)}</option>
        )}
        {c.options.map((o) => (
          <option key={o}>{o}</option>
        ))}
      </select>
    );
  return (
    <input
      aria-label={c.label}
      disabled={disabled}
      type={["number", "date"].includes(c.type) ? c.type : "text"}
      step="any"
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => {
        if (v !== initial)
          onSave(c.type === "number" && v !== "" ? Number(v) : v);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.target.blur();
      }}
    />
  );
}
