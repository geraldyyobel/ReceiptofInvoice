import React from 'react';
import {dateBounds} from '../../shared/date-limits';
export function DateRules({field,update,timeZone}) {
  const r=field.validation || {},set=patch=>update({validation:{...r,...patch}});
  let bounds;try{bounds=dateBounds(r,{timeZone});}catch{bounds={};}
  return <section>
    <h3>Batas tanggal</h3>
    <label>Maksimal bulan ke belakang dari hari ini
      <input type="number" min="0" max="1200" step="1" placeholder="Tanpa batas" value={r.monthsBack ?? ''} onChange={e=>set({monthsBack:e.target.value===''?null:Number(e.target.value)})}/>
    </label>
    <small>Isi 6 untuk mengizinkan tanggal mulai 6 bulan kalender sebelum hari ini. Batas berubah otomatis setiap hari sesuai zona waktu aplikasi.</small>
    <label className="check-label"><input type="checkbox" checked={!!r.noFuture} onChange={e=>set({noFuture:e.target.checked})}/>Tidak boleh memilih tanggal setelah hari ini</label>
    <div className="form-grid">
      <label>Tanggal paling awal (opsional)<input type="date" value={r.dateMin || ''} onChange={e=>set({dateMin:e.target.value})}/></label>
      <label>Tanggal paling akhir (opsional)<input type="date" value={r.dateMax || ''} onChange={e=>set({dateMax:e.target.value})}/></label>
    </div>
    <p className="muted">Rentang yang berlaku hari ini: {bounds.min || 'tanpa batas awal'} s.d. {bounds.max || 'tanpa batas akhir'}. Jika digabungkan, batas yang lebih ketat berlaku. Kosongkan batas dan hapus centang untuk mengizinkan semua tanggal.</p>
  </section>;
}
