import React, { useEffect, useState } from "react";
import { api, modeClient } from "./api";
import { Busy, Notice } from "./ui";
import { NotificationSummary } from "./notifications";
import { useLocation, queryUpdate } from "./navigation";

const number = (n) => new Intl.NumberFormat("id-ID").format(n);
// Keep the server's exact decimal string, including amounts above Number's safe integer range.
const money = (value) => {
  const [whole, fraction = "00"] = String(value).split(".");
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ".") + "," + fraction.padEnd(2, "0").slice(0, 2);
};
const months = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
function BarChart({ rows, monthly }) {
  const max = Math.max(1, ...rows.map((r) => r.count)), width = 900, height = 220, bottom = 180;
  const step = (width - 50) / rows.length;
  const label = (r) => monthly ? months[Number(r.key.slice(5)) - 1] : r.key.slice(8) + "/" + r.key.slice(5, 7);
  return <>
    <div className="dashboard-chart-scroll" tabIndex={0} role="region" aria-label="Grafik tren, dapat digeser ke samping"><svg className="dashboard-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={monthly ? "Jumlah invoice per bulan tahun buku" : "Jumlah penyerahan diterima per hari selama 30 hari terakhir"}>
      {[0, .5, 1].map((f) => <g key={f}><line x1="40" x2="895" y1={bottom - f * 155} y2={bottom - f * 155} stroke="#dfe6e2" /><text x="32" y={bottom - f * 155 + 4} textAnchor="end">{number(Math.round(max * f))}</text></g>)}
      {rows.map((r, i) => <g key={r.key}><rect x={45 + i * step} y={bottom - r.count / max * 155} width={Math.max(2, step - 6)} height={r.count / max * 155} rx="3" fill="var(--primary)"><title>{r.key}: {r.count} penyerahan</title></rect>
        {(monthly || i % 5 === 0 || i === rows.length - 1) && <text x={45 + i * step + (step - 6) / 2} y="202" textAnchor="middle">{label(r)}</text>}</g>)}
    </svg></div>
    <details className="chart-data"><summary>Lihat angka grafik</summary><div className="dashboard-data-grid">{rows.map((r) => <span key={r.key}>{r.key}: <b>{number(r.count)}</b></span>)}</div></details>
  </>;
}
function Composition({ title, data }) {
  const total = data.yes + data.no + data.unknown;
  return <div className="composition"><h3>{title}</h3><div className="composition-track" aria-hidden="true">
    {["yes", "no", "unknown"].map((k) => <span key={k} className={"composition-" + k} style={{ width: `${total ? data[k] / total * 100 : 0}%` }} />)}
  </div><div className="composition-labels">{[["yes", "Ya"], ["no", "Tidak"], ["unknown", "Tidak diisi"]].map(([k, label]) => <span key={k}>{label}: <b>{number(data[k])}</b> ({total ? (data[k] / total * 100).toFixed(1).replace(".", ",") : "0"}%)</span>)}</div></div>;
}
const duration = (seconds) => seconds === null ? "—" : seconds < 60 ? `${Math.round(seconds)} detik` : seconds < 3600 ? `${(seconds / 60).toFixed(1).replace(".", ",")} menit` : `${(seconds / 3600).toFixed(1).replace(".", ",")} jam`;

export function Dashboard({ navigate, admin }) {
  const { api, download } = modeClient();
  const can = (menu) => admin.menus.includes(menu);
  const canSeeData = can("data");
  const route = useLocation();
  const year = /^\d{4}$/.test(route.searchParams.get("year") || "") ? route.searchParams.get("year") : "current";
  const setYear = (value) => queryUpdate({ year: value });
  const [data, setData] = useState(null), [error, setError] = useState(""), [loading, setLoading] = useState(true);
  const [trend, setTrend] = useState("daily"), [ranking, setRanking] = useState("count"), [currency, setCurrency] = useState("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true); setError("");
    api("/admin/dashboard?year=" + encodeURIComponent(year)).then((d) => { if (active) setData(d); })
      .catch((e) => { if (active) setError(e.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [year, refresh, canSeeData]);
  const d = !loading && !error ? data : null;
  const selectedCurrency = d?.topByValue.find((r) => r.currency === currency) || d?.topByValue[0];
  return <div className="dashboard">
    <div className="between dashboard-filters"><label>Tahun buku<select aria-label="Tahun buku ringkasan" value={year} onChange={(e) => setYear(e.target.value)}>
      <option value="current">Tahun berjalan ({data?.currentYear || "…"})</option>
      {data?.years.map((y) => <option key={y.year} value={y.year}>{y.year}</option>)}
    </select></label><button className="secondary small" onClick={() => setRefresh((n) => n + 1)} disabled={loading}>Perbarui ringkasan</button></div>
    {can("notifications") && <NotificationSummary onOpen={() => navigate("notifications")} />}
    <Notice type="error">{error}</Notice>
    {loading && <Busy />}
    {d && <>
      <p className="muted dashboard-scope">Buku {d.year} · {d.zone}. Seluruh angka di bawah mengikuti tahun buku ini, berdasarkan tanggal invoice. Waktu penerimaan digunakan untuk metrik hari ini, 7 hari dan tren harian.</p>
      <div className="stats dashboard-stats">
        {[["Total penyerahan", d.total, `Tahun buku ${d.year}`], ["Masuk hari ini", d.today, "Diterima hari ini"], ["7 hari terakhir", d.last7, "Termasuk hari ini"], ["Vendor unik", d.vendors, "Nama tanpa beda huruf besar/kecil"], ["Email gagal", d.failed, "Percobaan kirim yang gagal"]].map(([label, n, help]) => <div className="stat" key={label}><span>{label}</span><strong>{number(n)}</strong><small>{help}</small></div>)}
      </div>
      <section className="paper"><div className="between"><div><h2>Tren penyerahan</h2><p className="muted">{trend === "daily" ? "Penerimaan 30 hari terakhir, dibatasi tahun buku aktif." : "Bulan tanggal invoice dalam tahun buku aktif; tanpa tanggal invoice memakai bulan penerimaan."}</p></div>
        <select aria-label="Periode tren" value={trend} onChange={(e) => setTrend(e.target.value)}><option value="daily">30 hari terakhir</option><option value="monthly">Per bulan tahun buku</option></select></div>
        <BarChart rows={d[trend]} monthly={trend === "monthly"} />
      </section>
      <div className="dashboard-grid">
        <section className="paper"><h2>Nilai tagihan per mata uang</h2><p className="muted">Amount (Nett) + VAT. Tanpa konversi kurs.</p>
          {!d.currencies.length && <p className="empty">Belum ada tagihan.</p>}
          <dl className="currency-list">{d.currencies.map((c) => <div key={c.currency}><dt>{c.currency}</dt><dd>{money(c.total)}</dd></div>)}</dl>
        </section>
        <section className="paper"><div className="between"><h2>Status email</h2>{can("logs") && <button className="secondary small" onClick={() => navigate("logs", { tab: "email" })}>Buka Email Log →</button>}</div>
          <div className="email-totals"><span>Berhasil<strong>{number(d.emails.sent)}</strong></span><span>Gagal<strong>{number(d.emails.failed)}</strong></span></div>
          <p className="muted">Jumlah percobaan kirim untuk invoice buku {d.year}, termasuk kirim ulang. Email tes tanpa invoice tidak dihitung. Email Log menampilkan riwayat lengkap mode aktif.</p>
        </section>
      </div>
      <section className="paper"><div className="between"><h2>Top 10 vendor</h2><div className="inline wrap"><select aria-label="Peringkat vendor" value={ranking} onChange={(e) => setRanking(e.target.value)}><option value="count">Jumlah penyerahan</option><option value="value">Nilai tagihan</option></select>
        {ranking === "value" && <select aria-label="Mata uang peringkat vendor" value={selectedCurrency?.currency || ""} onChange={(e) => setCurrency(e.target.value)}>{d.topByValue.map((c) => <option key={c.currency}>{c.currency}</option>)}</select>}</div></div>
        <div className="table-scroll"><table><thead><tr><th>Vendor</th><th>Penyerahan</th><th>Nilai tagihan</th></tr></thead><tbody>
          {(ranking === "count" ? d.topVendors : selectedCurrency?.vendors || []).map((v) => <tr key={v.name}><td>{v.name}</td><td>{number(v.count)}</td><td>{ranking === "count" ? v.currencies.map((c) => <div key={c.currency}>{c.currency} {money(c.total)}</div>) : `${selectedCurrency.currency} ${money(v.total)}`}</td></tr>)}
        </tbody></table></div>{!d.total && <p className="empty">Belum ada penyerahan.</p>}
      </section>
      <section className="paper"><h2>Komposisi tagihan</h2><div className="dashboard-compositions"><Composition title="Dengan PPN" data={d.compositions.vat} /><Composition title="Tagihan jasa" data={d.compositions.service} /><Composition title="Memakai subvendor" data={d.compositions.subvendor} /></div></section>
      <div className="dashboard-grid">
        <section className="paper"><h2>Sumber permintaan</h2>{!d.sources.length && <p className="empty">Belum ada data.</p>}
          {d.sources.map((s) => <div className="source-row" key={s.name}><div className="between"><span>{s.name}</span><b>{number(s.count)}</b></div><div className="source-track" aria-hidden="true"><span style={{ width: `${s.count / Math.max(1, d.total) * 100}%` }} /></div></div>)}
        </section>
        <section className="paper"><h2>Waktu pengisian rata-rata</h2><strong className="duration-value">{duration(d.duration.averageSeconds)}</strong><p>{number(d.duration.valid)} penyerahan dengan waktu valid.</p><p className="muted">Dihitung dari mulai hingga submit, termasuk waktu jeda atau draft. {d.duration.excluded > 0 && `${number(d.duration.excluded)} waktu tidak valid dikecualikan.`}</p></section>
      </div>
      {canSeeData && <section className="paper"><h2>Perlu tindak lanjut</h2><div className="dashboard-grid">
        {[["legality", "Legalitas belum terkirim"], ["email", "Pengiriman terakhir gagal"]].map(([kind, label]) => <div key={kind} className="followup-group"><div className="between"><h3>{label} ({number(d.followups[kind].count)})</h3><button className="secondary small" onClick={() => navigate("data", { year: String(d.year), followup: kind })}>Lihat semua →</button></div>
          {!d.followups[kind].rows.length ? <p className="muted">Tidak ada tindak lanjut.</p> : <ul className="followup-list">{d.followups[kind].rows.map((r) => <li key={r.id}><span>{r.vendor}</span><button className="text-button" onClick={() => navigate("data", { year: String(d.year), followup: kind, q: r.reference })}>{r.reference} →</button></li>)}</ul>}
        </div>)}
      </div><p className="muted">Legalitas: jawaban “Belum”. Email: status percobaan terakhir per invoice; berhasil dikirim ulang akan keluar dari daftar.</p></section>}
    </>}
  </div>;
}
