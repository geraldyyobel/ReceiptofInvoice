import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { panelState, reviewKeys, reviewValues, dirtyReview, mergePanelRow, acceptReviewSave, displayCell, sameCell } from "../../shared/custom-panel-state";

export function CustomRowPanel(props) {
  const callbacks = useRef(props); callbacks.current = props;
  const owner = useRef(null); if (!owner.current) owner.current = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
  const [state, setState] = useState(() => ({ ...panelState(props.row, props.cached), cells: props.cached?.cells || props.cells, owner: owner.current }));
  const current = useRef(state), alive = useRef(true), dialog = useRef(null),
    reading = useRef(0), queue = useRef(Promise.resolve()), contextVersion = useRef(0);
  const [saving, setSaving] = useState(0), [checking, setChecking] = useState(false),
    [master, setMaster] = useState(null), [masterError, setMasterError] = useState("");
  const ownsDraft = () => !callbacks.current.readCached()?.owner || callbacks.current.readCached().owner === owner.current;
  function change(fn) {
    if (!ownsDraft() && !alive.current) return current.current;
    const next = fn(current.current); current.current = next;
    callbacks.current.persist(next);
    if (alive.current) setState(next);
    return next;
  }
  function reviewChange(key, value) { change((s) => ({ ...s, draft: { ...s.draft, [key]: value }, saved: false })); }
  function saveReview(keys = reviewKeys) {
    queue.current = queue.current.then(async () => {
      const before = current.current;
      if (!ownsDraft()) return;
      const changed = dirtyReview(before).filter((key) => keys.includes(key));
      if (!changed.length || before.conflict || before.unavailable) return;
      const sent = Object.fromEntries(changed.map((key) => [key, before.draft[key]])), context = before.context;
      reading.current++; // Ignore a read begun before this write.
      const expectedReview = Object.fromEntries(changed.map((key) => [key, before.base[key]]));
      if (alive.current) { setSaving((n) => n + 1); setChecking(false); }
      callbacks.current.activity(1);
      change((s) => ({ ...s, error: "" }));
      try {
        const row = await callbacks.current.api("/admin/custom/rows/" + before.row.id, {
          method: "PATCH", body: { ...sent, expectedReview, expectedBookYear: before.row.bookYear },
        });
        if (current.current.context !== context || !ownsDraft()) return;
        change((s) => acceptReviewSave(s, row, sent, context));
        callbacks.current.saved(row);
      } catch (e) {
        if (current.current.context !== context || !ownsDraft()) return;
        change((s) => ({ ...s, saved: false, error: e.message || "Koneksi terputus. Draf tetap disimpan.",
          row: e.details?.code === "CUSTOM_ROW_MOVED" ? { ...s.row, bookYear: e.details.bookYear, bookNumber: e.details.bookNumber } : s.row,
          context: e.details?.code === "CUSTOM_ROW_MOVED" ? s.context + 1 : s.context,
          unavailable: e.status === 404 ? "missing" : e.details?.code === "CUSTOM_ROW_MOVED" ? "moved" : s.unavailable,
          conflict: e.status === 409 && e.details?.current ? { ...e.details, keys: changed } : s.conflict,
        }));
      } finally {
        if (alive.current) setSaving((n) => n - 1);
        callbacks.current.activity(-1);
      }
    }).catch((e) => change((s) => ({ ...s, error: e.message, saved: false })));
    return queue.current;
  }
  async function readRow(reload = false) {
    const serial = ++reading.current, version = contextVersion.current;
    if (alive.current) setChecking(true);
    try {
      const fresh = await callbacks.current.api("/admin/custom/rows/" + current.current.row.id);
      if (!alive.current || serial !== reading.current || version !== contextVersion.current) return;
      change((s) => reload ? { ...panelState(fresh.row), cells: fresh.cells, context: s.context + 1 }
        : { ...mergePanelRow(s, fresh.row), cells: fresh.cells });
      callbacks.current.saved(fresh.row);
    } catch (e) {
      if (!alive.current || serial !== reading.current || version !== contextVersion.current) return;
      change((s) => ({ ...s, unavailable: e.status === 404 ? "missing" : s.unavailable, error: e.message, saved: false }));
    } finally { if (alive.current && serial === reading.current) setChecking(false); }
  }
  function reloadReview() {
    // A reload is an explicit choice to discard this row's local drafts.
    void readRow(true);
  }
  function overwrite() {
    if (!current.current.conflict?.current || current.current.unavailable) return;
    change((s) => {
      const dirty = dirtyReview(s), remote = s.conflict.current, draft = { ...s.draft };
      for (const key of reviewKeys) if (!dirty.includes(key)) draft[key] = remote[key];
      return { ...s, base: { ...s.base, ...remote }, draft, conflict: null, error: "" };
    });
    void saveReview();
  }
  async function saveCell(column, value) {
    const before = current.current, context = before.context;
    reading.current++; contextVersion.current++;
    if (alive.current) setChecking(false);
    change((s) => ({ ...s, cellErrors: { ...s.cellErrors, [column.id]: "" }, cellsSaving: { ...s.cellsSaving, [column.id]: true } }));
    try {
      const result = await callbacks.current.updateCell(before.row, column, { value });
      if (current.current.context !== context || !ownsDraft()) return;
      const { bookRow, ...cell } = result;
      change((s) => {
        const next = bookRow ? mergePanelRow(s, bookRow) : { ...s };
        const cellDrafts = { ...s.cellDrafts };
        if (cellDrafts[column.id] === value || String(cellDrafts[column.id]) === String(value)) delete cellDrafts[column.id];
        return { ...next, cellDrafts, cells: [...s.cells.filter((c) => c.columnId !== column.id), cell],
          saved: true, cellErrors: { ...s.cellErrors, [column.id]: "" } };
      });
    } catch (e) {
      if (current.current.context !== context || !ownsDraft()) return;
      change((s) => ({ ...s, unavailable: e.status === 404 ? "missing" : s.unavailable,
        cellErrors: { ...s.cellErrors, [column.id]: e.message || "Koneksi terputus" }, saved: false }));
    } finally { change((s) => ({ ...s, cellsSaving: { ...s.cellsSaving, [column.id]: false } })); }
  }
  const close = () => { document.activeElement?.blur(); void saveReview(); callbacks.current.close(); };
  const navigate = (offset) => { document.activeElement?.blur(); void saveReview(); callbacks.current.navigate(offset); };
  useEffect(() => {
    alive.current = true;
    callbacks.current.persist(current.current);
    void readRow();
    return () => { alive.current = false; reading.current++; };
  }, []);
  useEffect(() => {
    const focus = () => { if (!saving) void readRow(); };
    window.addEventListener("focus", focus);
    return () => window.removeEventListener("focus", focus);
  }, [saving]);
  useEffect(() => {
    if (!props.canReadMaster || !state.row.masterId) { setMaster(null); return; }
    let cancelled = false; setMaster(null); setMasterError("");
    callbacks.current.api("/admin/submissions/" + state.row.masterId).then((value) => {
      if (!cancelled) setMaster(value);
    }).catch((e) => { if (!cancelled) setMasterError(e.status === 403 ? "Akses pembanding master tidak tersedia." : "Pembanding master belum dapat dimuat."); });
    return () => { cancelled = true; };
  }, [props.canReadMaster, state.row.masterId]);
  useEffect(() => {
    const overlay = dialog.current.parentElement;
    const siblings = [...document.body.children].filter((node) => node !== overlay);
    const previous = siblings.map((node) => [node, node.inert]);
    for (const [node] of previous) node.inert = true;
    const overflow = document.body.style.overflow; document.body.style.overflow = "hidden";
    dialog.current.focus();
    function keydown(e) {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); return; }
      const controls = [...dialog.current.querySelectorAll('button,input,textarea,select,a[href],[tabindex="0"]')]
        .filter((el) => !el.disabled && el.getClientRects().length);
      if (e.key === "Tab" && controls.length) {
        const index = controls.indexOf(document.activeElement);
        if (e.shiftKey && index <= 0) { e.preventDefault(); controls.at(-1).focus(); }
        else if (!e.shiftKey && (index === controls.length - 1 || index === -1)) { e.preventDefault(); controls[0].focus(); }
      }
      if (e.ctrlKey || e.metaKey || e.altKey || e.target.closest("input,textarea,select,[contenteditable=true]")) return;
      if (e.key.toLowerCase() === "j" && callbacks.current.position < callbacks.current.count - 1) { e.preventDefault(); navigate(1); }
      if (e.key.toLowerCase() === "k" && callbacks.current.position > 0) { e.preventDefault(); navigate(-1); }
    }
    const containFocus = (e) => { if (dialog.current && !dialog.current.contains(e.target)) dialog.current.focus(); };
    document.addEventListener("keydown", keydown, true); document.addEventListener("focusin", containFocus);
    return () => {
      document.removeEventListener("keydown", keydown, true); document.removeEventListener("focusin", containFocus);
      for (const [node, inert] of previous) node.inert = inert;
      document.body.style.overflow = overflow;
    };
  }, []);
  const lookup = new Map(state.cells.map((c) => [c.columnId, c.value]));
  const dirty = dirtyReview(state), hasCellDrafts = Object.keys(state.cellDrafts).length > 0;
  const cellSaving = Object.values(state.cellsSaving || {}).some(Boolean);
  const disabled = !!state.unavailable || props.busy;
  const status = saving || cellSaving ? "Menyimpan…" : state.error || state.conflict || Object.values(state.cellErrors || {}).some(Boolean)
    ? "Gagal" : dirty.length || hasCellDrafts ? "Belum tersimpan" : "Tersimpan";
  const Input = props.CellInput;
  return createPortal(
    <div className="custom-panel-overlay" style={props.theme} onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <section className="custom-row-panel" role="dialog" aria-modal="true" aria-label="Detail baris tabel kustom" tabIndex={-1} ref={dialog}>
        <header className="custom-panel-header">
          <div><small>TABEL KUSTOM · DETAIL BARIS</small><h2>No. Buku {state.row.bookNumber ?? "—"}</h2>
            <p>Tahun buku {state.row.bookYear ?? "—"} · {state.row.masterId ? "Salinan master" : "Baris manual"}</p></div>
          <button type="button" className="secondary" aria-label="Tutup detail baris" onClick={close}>✕</button>
        </header>
        <div className="custom-panel-content">
          {state.unavailable && <div className="notice error" role="alert">{state.unavailable === "missing"
            ? "Baris tidak lagi tersedia atau telah dihapus. Draf Anda tetap disimpan; data di bawah tidak dapat diedit."
            : "Baris telah berpindah tahun buku. Periksa pembaruan dan pilih Muat ulang baris sebelum melanjutkan."}
            {state.unavailable !== "missing" && <button type="button" className="secondary" onClick={reloadReview}>Muat ulang baris</button>}</div>}
          <section className="custom-panel-review" aria-labelledby="custom-review-title">
            <div className="custom-review-heading">
            <div className="between"><h3 id="custom-review-title">Review</h3><span role="status" aria-live="polite" className={status === "Gagal" ? "review-save-error" : "muted"}>{status}</span></div>
            <div className="button-row">{["undo", "redo"].map((direction) =>
              <button type="button" className="secondary small" key={direction}
                disabled={props.busy || props.writes > 0 || !!dirty.length || hasCellDrafts || !props.history?.[direction + "Count"]}
                onClick={async () => { await callbacks.current.travel(direction); if (alive.current) void readRow(); }}>
                {direction === "undo" ? "↶ Undo" : "↷ Redo"}</button>)}</div>
            </div><div className="custom-review-controls">
            <label className="check-label"><input type="checkbox" checked={state.draft.reviewChecked} disabled={disabled}
              onChange={(e) => { reviewChange("reviewChecked", e.target.checked); void saveReview(["reviewChecked"]); }} />Dicek</label>
            <fieldset className="custom-review-flags" disabled={disabled}><legend>Penanda</legend>
              {[["followup", "⚑", "Perlu tindak lanjut"], ["problem", "!", "Bermasalah"]].map(([flag, icon, label]) =>
                <button key={flag} type="button" className={"review-flag " + flag} aria-pressed={state.draft.reviewFlag === flag}
                  onClick={() => { reviewChange("reviewFlag", state.draft.reviewFlag === flag ? null : flag); void saveReview(["reviewFlag"]); }}><span aria-hidden="true">{icon}</span> {label}</button>)}
              <button type="button" className="secondary" disabled={!state.draft.reviewFlag} onClick={() => { reviewChange("reviewFlag", null); void saveReview(["reviewFlag"]); }}>Hapus penanda</button>
            </fieldset>
            </div>
            <label>Catatan review<textarea aria-label="Catatan review" maxLength={2000} value={state.draft.reviewNote ?? ""} readOnly={disabled}
              onChange={(e) => reviewChange("reviewNote", e.target.value)} onBlur={() => { void saveReview(["reviewNote"]); }} aria-describedby="review-note-count" /></label>
            <small id="review-note-count">{(state.draft.reviewNote || "").length}/2.000 karakter · Disimpan saat keluar dari kolom.</small>
            {state.conflict && <div className="review-conflict" role="alert"><strong>Review diubah admin lain. Draf Anda tetap disimpan.</strong>
              <p>Nilai terbaru dari server:</p><dl>{reviewKeys.map((key) => <React.Fragment key={key}><dt>{({ reviewChecked: "Dicek", reviewFlag: "Penanda", reviewNote: "Catatan" })[key]}</dt>
                <dd>{key === "reviewFlag" ? ({ followup: "Perlu tindak lanjut", problem: "Bermasalah" })[state.conflict.current[key]] || "Tanpa tanda" : displayCell(state.conflict.current[key])}</dd></React.Fragment>)}</dl>
              <div className="button-row"><button type="button" onClick={overwrite} disabled={disabled || saving > 0}>Timpa</button>
                <button type="button" className="secondary" disabled={saving > 0} onClick={reloadReview}>Muat ulang</button></div></div>}
            {state.error && !state.conflict && <div className="notice error" role="alert">{state.error}
              {!disabled && <button type="button" className="secondary" onClick={() => void saveReview()}>Coba lagi</button>}</div>}
          </section>
          <div className="between"><h3>Seluruh field</h3><button type="button" className="secondary small" disabled={checking || saving > 0 || cellSaving} onClick={() => void readRow()}>Periksa pembaruan</button></div>
          {masterError && <p className="muted">{masterError}</p>}
          <div className="custom-panel-fields">
          {props.columns.map((column) => {
            const value = lookup.get(column.id) ?? "", draft = Object.hasOwn(state.cellDrafts, column.id) ? state.cellDrafts[column.id] : value;
            const masterValues = master ? { ...master.values, nomor_referensi: master.reference } : null;
            const original = masterValues?.[column.code];
            return <div key={column.id} className="custom-panel-field"><span className="custom-panel-label" title={column.label}>{column.label}{column.hidden && <small> · Kolom tersembunyi</small>}</span>
              <Input column={column} initial={value} draft={draft} disabled={disabled || !!state.cellsSaving?.[column.id]}
                onDraft={(v) => change((s) => { const cellDrafts = { ...s.cellDrafts };
                  if (sameCell(v, value, column.type)) delete cellDrafts[column.id]; else cellDrafts[column.id] = v;
                  return { ...s, saved: false, cellDrafts }; })}
                onSave={(v) => void saveCell(column, v)} />
              {masterValues && Object.hasOwn(masterValues, column.code) && !sameCell(draft, original, column.type) && <small className="custom-master-value">Master: {displayCell(original)}</small>}
              {state.cellErrors?.[column.id] && <div role="alert" className="review-save-error">{state.cellErrors[column.id]} <button type="button" className="secondary small" disabled={disabled} onClick={() => void saveCell(column, column.type === "number" && draft !== "" ? Number(draft) : draft)}>Coba lagi: {column.label}</button></div>}
            </div>;
          })}
          </div>
        </div>
        <footer className="custom-panel-footer"><button type="button" className="secondary" disabled={props.position <= 0} onClick={() => navigate(-1)}>← Sebelumnya</button>
          <span>{props.position + 1} dari {props.count}</span><button type="button" className="secondary" disabled={props.position >= props.count - 1} onClick={() => navigate(1)}>Berikutnya →</button>
        </footer>
      </section>
    </div>, document.body,
  );
}
