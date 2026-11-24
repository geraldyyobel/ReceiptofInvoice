import React, { useEffect, useState } from "react";
import { api, download, date, modeClient } from "./api";
import { Busy, Notice, Pager } from "./ui";
export function CustomBackups() {
  const { api, download } = modeClient();
  const [list, setList] = useState(null),
    [page, setPage] = useState(1),
    [selected, setSelected] = useState(""),
    [snapshot, setSnapshot] = useState(null),
    [error, setError] = useState(""),
    [hidden, setHidden] = useState(false),
    [downloading, setDownloading] = useState(false);
  useEffect(() => {
    let active = true;
    setList(null);
    setError("");
    api(`/admin/custom/backups?page=${page}&size=20`)
      .then((d) => {
        if (active) setList(d);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [page]);
  useEffect(() => {
    let active = true;
    setSnapshot(null);
    setError("");
    if (selected)
      api("/admin/custom/backups/" + selected)
        .then((d) => {
          if (active) setSnapshot(d);
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    return () => {
      active = false;
    };
  }, [selected]);
  async function exportBackup(format) {
    setDownloading(true);
    setError("");
    try {
      await download(
        `/admin/custom/backups/${snapshot.backupId}/export/${format}`,
        `backup-tabel-kustom-${snapshot.mode}-${snapshot.capturedAt.replace(/[:.]/g, "-")}.${format}`,
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setDownloading(false);
    }
  }
  const columns = snapshot?.columns.filter((c) => hidden || !c.hidden) || [],
    rows = snapshot?.rows.slice(0, 50) || [];
  const cells = new Map(
    snapshot?.cells.map((c) => [`${c.rowId}:${c.columnId}`, c]) || [],
  );
  return (
    <div className="custom-backups">
      <Notice type="error">{error}</Notice>
      {!list ? (
        !error && <Busy />
      ) : (
        <>
          <p>
            Backup otomatis pukul <b>{list.schedule.join(" dan ")}</b> (
            {list.timeZone}), retensi {list.retentionDays} hari. Aplikasi harus
            tetap menyala. Daftar juga memuat backup manual dan backup pengaman.
          </p>
          <p className="muted">
            Hanya tabel kustom mode <b>{list.mode.toUpperCase()}</b> yang
            ditampilkan. Memilih backup tidak mengubah tabel saat ini.
          </p>
          {list.rows.length ? (
            <label>
              Pilih waktu backup
              <select
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
              >
                <option value="">Pilih tanggal dan waktu...</option>
                {list.rows.map((b) => (
                  <option key={b.id} value={b.id}>
                    {date(b.createdAt)}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <Notice>
              Belum ada backup tersedia. Backup akan muncul setelah jadwal
              berikutnya berjalan atau Super Admin membuat backup dari Logs
              &amp; Backup.
            </Notice>
          )}
          {list.total > 20 && (
            <Pager
              page={page}
              size={20}
              total={list.total}
              onChange={(p) => {
                setSelected("");
                setPage(p);
              }}
            />
          )}
        </>
      )}
      {selected && !snapshot && !error && <Busy>Memuat salinan tabel...</Busy>}
      {snapshot && (
        <>
          <p>
            <b>Salinan: {date(snapshot.capturedAt)}</b> · {snapshot.rows.length}{" "}
            baris · {snapshot.columns.length} kolom · {snapshot.views.length}{" "}
            view
          </p>
          {snapshot.scheduledSlot && (
            <small>
              Slot terjadwal: {snapshot.scheduledSlot} ({list?.timeZone}). Waktu
              pembuatan dapat berbeda jika aplikasi baru dinyalakan kembali.
            </small>
          )}
          <div className="button-row">
            {["xlsx", "csv", "json"].map((format) => (
              <button
                key={format}
                className="secondary"
                disabled={downloading}
                onClick={() => exportBackup(format)}
              >
                Unduh backup {format.toUpperCase()}
              </button>
            ))}
          </div>
          <small>
            XLSX menyimpan warna dan semua kolom, termasuk kolom tersembunyi.
            CSV memuat semua kolom tanpa warna. JSON memuat salinan lengkap
            tabel, warna, susunan kolom, dan view.
          </small>
          <label className="check-label">
            <input
              type="checkbox"
              checked={hidden}
              onChange={(e) => setHidden(e.target.checked)}
            />
            Tampilkan kolom tersembunyi dalam pratinjau
          </label>
          <div className="table-scroll">
            <table className="custom-table snapshot-table">
              <thead>
                <tr>
                  <th>No.</th>
                  {columns.map((c) => (
                    <th key={c.id} style={{ background: c.color || undefined }}>
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.id}>
                    <td>{i + 1}</td>
                    {columns.map((c) => {
                      const cell = cells.get(`${r.id}:${c.id}`),
                        value = cell?.value;
                      return (
                        <td
                          key={c.id}
                          style={{
                            background:
                              cell?.color || r.color || c.color || undefined,
                          }}
                        >
                          {typeof value === "boolean"
                            ? value
                              ? "Ya"
                              : "Tidak"
                            : Array.isArray(value)
                              ? value.join("; ")
                              : value == null
                                ? ""
                                : String(value)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!snapshot.rows.length && <p>Tabel pada backup ini masih kosong.</p>}
          {snapshot.rows.length > 50 && (
            <small>
              Pratinjau menampilkan 50 baris pertama. Unduhan mencakup seluruh
              baris.
            </small>
          )}
        </>
      )}
    </div>
  );
}
