# REST API ROI BCU

Semua rute di bawah memakai prefix `/api`, JSON, dan cookie session same-origin. Respons gagal: `{ "error": "Pesan", "details": { "kode_field": "Kesalahan" } }`. Status utama: 400 format/aturan tidak valid, 401 perlu login, 403 akses/CSRF, 404 tidak ada, 409 versi/identitas bertabrakan, 422 validasi jawaban, 429 pembatasan, 503 pemeliharaan backup.

## Autentikasi dan CSRF

1. `GET /csrf` mengembalikan `{token}` dan cookie bertanda tangan.
2. Sertakan `X-CSRF-Token: token` pada **semua mutasi**, termasuk login, logout, upload dan pengiriman publik.
3. `POST /auth/login` dengan `{email,password}` membuat cookie httpOnly. `GET /auth/me` mengembalikan admin dan mode aktif. `POST /auth/logout` menutup session.
4. `POST /admin/mode` dengan `{mode:"internal"|"eksternal"}` memilih mode pada session. Semua endpoint admin lainnya memerlukan mode. Jangan mengirim mode melalui query untuk melewati ruang kerja aktif.

## Publik

| Metode | Rute | Keterangan |
|---|---|---|
| GET | `/health` | Kesiapan database |
| GET | `/public/config` | Nama/logo/warna/zona waktu, tanpa rahasia |
| GET | `/public/:mode/form` | `{form,terms,mode}` berisi versi dan ketentuan terpublikasi |
| POST | `/public/:mode/submit` | Simpan jawaban bersih dan nomor referensi |
| POST | `/public/:mode/upload` | Multipart `file`, mengembalikan `id`, `value` dan nama |
| GET | `/public/submissions/:id/document/pdf` | PDF A4 |
| GET | `/public/submissions/:id/document/html` | HTML siap cetak |
| POST | `/public/submissions/:id/email` | `{email}`; PDF sebagai lampiran |

Download/email publik memerlukan `X-Document-Token` dari respons submit. Token tidak diletakkan pada URL. Upload vendor privat hanya dilayani melalui endpoint admin; gunakan `value` yang dikembalikan sebagai nilai field file.

Payload submit:

```json
{
  "formVersionId": "id dari form",
  "termsVersionId": "id dari terms",
  "accepted": true,
  "startedAt": "2026-10-30T08:00:00.000Z",
  "values": {
    "paham_ketentuan": "Ya",
    "email_anda": "vendor@example.com",
    "received_from": "PT Contoh",
    "invoice_number": "INV-001",
    "invoice_date": "2026-10-30",
    "currency": "IDR",
    "amount_nett": "1000000.00",
    "ada_ppn": "Tidak",
    "invoice_jasa": "Tidak",
    "ada_subvendor_1": "Tidak",
    "legalitas_terkirim": "Belum",
    "permintaan_via": "Email",
    "po_number": "PO-001"
  }
}
```

Respons: `{id,reference,token,email}`. Nilai tersembunyi dibuang server. `total`, nomor, mode, waktu selesai dan snapshot dokumen tidak dipercaya dari klien. Draft lokal yang memakai versi lama harus dimuat ulang setelah publish baru.

## Admin pada mode aktif

| Kelompok | Rute |
|---|---|
| Ringkasan | `GET /admin/dashboard`, `POST /admin/review` dengan `{reviewed:boolean}` |
| Master | `GET /admin/submissions`, `GET /admin/submissions/:id`, `GET /admin/submissions/export/:format` |
| Dokumen master | `GET /admin/submissions/:id/document/:format`, `POST /admin/submissions/:id/email` |
| Ketentuan | `GET /admin/terms`, `PUT /admin/terms/draft`, `POST /admin/terms/preview`, `POST /admin/terms/version`, `POST /admin/terms/rollback/:id` |
| Form | `GET /admin/form`, `GET /admin/form/versions/:id`, `PUT /admin/form` |
| Template | `GET /admin/template`, `PUT /admin/template`, `POST /admin/template/preview/:format` |
| Upload | `POST /admin/uploads` multipart gambar publik, `GET /admin/uploads/:id` unduh privat terotorisasi |
| Salinan | `GET /admin/custom`, `POST /admin/custom/sync`, `POST /admin/custom/reset`, `GET /admin/custom/export/:format` |
| Undo/Redo salinan | `GET /admin/custom/history`, `POST /admin/custom/undo`, `POST /admin/custom/redo` |
| Aksi kolom berkelompok | `POST /admin/custom/columns/order`, `POST /admin/custom/columns/visibility` |
| Kolom salinan | `POST /admin/custom/columns`, `PATCH /admin/custom/columns/:id`, `DELETE /admin/custom/columns/:id` |
| Baris salinan | `POST /admin/custom/rows`, `PATCH /admin/custom/rows/:id`, `DELETE /admin/custom/rows/:id` |
| Sel salinan | `PUT /admin/custom/cell` |
| View salinan | `POST /admin/custom/views`, `DELETE /admin/custom/views/:id` |
| Log | `GET /admin/logs/activity`, `GET /admin/logs/email` |

- Master: query `q`, `vendor`, `status`, `from`, `to`, `year=current|all|YYYY, sort=reference|vendor|submittedAt|status|bookNumber`, `dir=asc|desc`, `page`, `size` (1–100). Tanggal `YYYY-MM-DD` mengikuti zona waktu Settings. Respons tabel `{rows,total,page,size}`.
- Log: query `q`, `from`, `to`, `page`, `size`, `export=csv|xlsx`. Log global akun/settings tampil bersama log mode aktif.
- Ketentuan: draft/preview `{html}`; versi `{html,publish:boolean}`. Rollback mengembalikan draft, tidak langsung publish.
- Form: `{fields,sections,baseVersionId,note}`. Setiap simpan membuat versi baru. `fields` memakai format seed `prisma/initial.js` dan divalidasi `shared/engine.js`. `showIf={join:"AND"|"OR",conditions:[leaf|group]}`; leaf `{field,operator,value}`. Opsi `{value,action:{type:"next"|"jump"|"end",target,message,returnToTerms}}`.
- Template: simpan `{html,baseVersionId}`, preview `{html,values}`. Format unduh `html|pdf`. HTML preview tidak menjalankan skrip. Placeholder hanya di teks, bukan atribut/CSS.
- Custom: query `year=current|all|YYYY`, `q` (maksimal 200 karakter), `sort=id_kolom|bookNumber`, `dir=asc|desc`, `page`, `size=1..100` (default 50). Pencarian/pengurutan dilakukan di server, respons hanya memuat sel dari baris halaman itu. `all=1` tidak lagi melewati pagination. Halaman di luar batas dijepit ke halaman terakhir. Respons menyertakan `{years:[{year,count}],year,currentYear,page,size,total}`, serta `bookYear`/`bookNumber` pada setiap baris. Kolom baru `{label,type,options:[]}`; patch kolom `{label,position,hidden,color,options}`. Sel `{rowId,columnId,value?,color?}`. Warna `#rrggbb` atau null. Patch baris `{color}`. Form publik yang berhasil disimpan langsung menambah baris salinan dalam transaksi yang sama. `POST /admin/custom/sync` memerlukan `{confirm:"SINKRONISASI ULANG"}`; hanya menambah baris master yang belum tersalin, tanpa menimpa edit atau membuat ulang kolom yang dihapus. Reset `{confirm:"RESET SALINAN"}` mengosongkan salinan; sinkronisasi ulang menyalin master kembali. Baris manual POST menerima `{year?:number}`. View `{name,config:{columns:[id],sort,dir,q,year}}`.
- Ekspor `format=csv|xlsx`. Spreadsheet melindungi nilai teks yang dapat dianggap formula. CSV tidak menyimpan warna. Tidak ada endpoint edit/hapus master.

## Super Admin (global)

| Metode | Rute | Payload |
|---|---|---|
| GET / PUT | `/admin/settings` | PUT parsial, kunci mengikuti `prisma/initial.js` |
| POST | `/admin/settings/test-email` | `{email}` |
| GET / POST | `/admin/admins` | POST `{name,email,password,role,active}` |
| PUT | `/admin/admins/:id` | `{name,email,password?,role,active}` |
| GET / POST | `/admin/backups` | POST membuat arsip segera |
| GET | `/admin/backups/:id/download` | Arsip terenkripsi |
| POST | `/admin/backups/:id/prepare-restore` | Mengembalikan `{token,phrase,message}` |
| POST | `/admin/backups/:id/restore` | `{token,confirm:phrase}` |

Password SMTP hanya dapat ditulis; GET mengembalikan `smtp_password_set`. Password kosong mempertahankan nilai lama. Role `admin|superadmin`; perubahan akun menutup seluruh session akun tersebut. Restore membuat backup pengaman, memulihkan kedua mode, dan menutup seluruh session. Backup/restore serta dump memakai proses tunggal; lihat batas operasi pada README.

Tampilan ketentuan: `GET /admin/terms` menyertakan `visibility={enabled,revision}`. Ubah dengan `PUT /admin/terms/visibility` berisi `{enabled,baseRevision}`. API form publik menyertakan `termsEnabled`, `termsRevision`, dan `termsVersionId`; `terms=null` saat OFF. Submit mengirim `termsRevision` dan `accepted` boolean. Server mewajibkan accepted=true hanya saat ON, serta menolak revisi status yang kedaluwarsa (409).

OAuth akun pengirim (Super Admin): `GET /admin/mail/status`, `POST /admin/mail/oauth/:provider/start` (CSRF, provider gmail|outlook), `DELETE /admin/mail/oauth/:provider` (CSRF). Start mengembalikan URL consent dan cookie binding. Callback publik `GET /email/oauth/:provider/callback` memvalidasi state sekali pakai, PKCE/binding serta session Super Admin asli, lalu redirect ke Settings. `email_transport=smtp|gmail|outlook|none` dipilih lewat Settings. Baris privat mail_oauth_* tidak dikembalikan oleh Settings atau dicatat dalam snapshot log.

Jadwal backup menggunakan `backup_jam` (default `00:00`) dan `backup_jam_kedua` (default `12:00`), keduanya `HH:mm` sesuai `zona_waktu`. Penanda slot `backup_last_slot` hanya ditulis setelah arsip terjadwal sukses; backup manual tidak melewatkan jadwal berikutnya.

Undo/Redo: GET history (juga properti `history` pada GET custom) mengembalikan `{undoCount,redoCount,undoId,redoId,undoLabel,redoLabel}` untuk akun dan mode session aktif. POST undo/redo wajib `{expectedId: undoId|redoId}` dari state terkini; 409 jika riwayat berubah/konflik atau kosong. Perubahan dan pergerakan jurnal dilakukan dalam transaksi Serializable; kegagalan tidak mengubah stack atau data. Konflik serialisasi juga 409. Maksimal 50 langkah; perubahan baru menghapus Redo, no-op tidak dicatat. Baris otomatis tidak menjadi langkah Undo dan tidak membuang Redo. Semua aksi sukses masuk Activity Log `custom.undo` / `custom.redo`.

Urutan kolom: `{ids:[semua_id_kolom_mode_dalam_urutan_baru]}`; harus lengkap, unik dan sesuai mode. Visibilitas: `{visible:[id_kolom_terlihat]}`. Masing-masing aksi dicatat sebagai satu langkah. Reset menghapus jurnal semua admin pada mode aktif; Restore menghapus seluruh jurnal. Jurnal tidak disertakan dalam dump. Sinkronisasi ulang dan Reset tidak menjadi langkah Undo.

Validasi field date mendukung validation: {monthsBack:6,noFuture:true,dateMin:"2026-01-01",dateMax:"2026-12-31"}. Semua properti opsional; monthsBack null mematikan batas relatif (bilangan bulat 0–1200), dateMin/dateMax kosong mematikan batas tetap. Batas inklusif, dihitung dari tanggal server menurut zona_waktu Settings; input tanggal di luar batas ditolak 422. Definisi negatif/tanggal tidak valid/rentang terbalik ditolak saat simpan form. GET admin/form menyertakan termsEnabled untuk menjelaskan pertanyaan paham_ketentuan yang disembunyikan saat OFF.

### Backup tabel kustom (Admin, mode aktif)
- GET /admin/custom/backups?page=1&size=20 mengembalikan {mode,page,size,rows:[{id,createdAt}],total,schedule,timeZone,retentionDays}. Hanya backup berstatus selesai ditampilkan.
- GET /admin/custom/backups/:id mengembalikan snapshot {version,backupId,mode,capturedAt,scheduledSlot,columns,rows,cells,views}. Data difilter menurut mode session, bukan parameter query. Tidak memuat settings, akun, master, unggahan, ataupun tabel mode lain.
- GET /admin/custom/backups/:id/export/:format mendukung xlsx/csv/json. Semua baris/kolom termasuk yang tersembunyi disertakan; warna dan status kolom tersembunyi dipertahankan pada XLSX. JSON memuat snapshot lengkap mode tersebut. Preview/unduhan tidak mengubah tabel aktif; audit custom.backup.preview/custom.backup.download dibuat.
- Endpoint ini tidak memberikan akses arsip database lengkap; GET /admin/backups/:id/download dan restore tetap khusus Super Admin. Arsip hilang/backup tidak ditemukan: 404. Format tidak dikenal: 400. Snapshot tidak valid: 422. Tidak ada skema/migration baru.

Pembaruan validasi keamanan 13 November 2026: password akun dan login maksimal 72 byte UTF-8 (422 bila melebihi); field tanggal tabel kustom wajib tanggal kalender YYYY-MM-DD yang nyata (400 bila salah). Pagination page/size dibulatkan ke bilangan bulat dan dibatasi seperti sebelumnya. Placeholder setting hanya mengakses metadata dokumen, bukan seluruh Settings.


## Pembukuan tahunan / ekspor kustom

Master dan salinan menyimpan bookYear/bookNumber. bookYear ditentukan dari invoice_date; jika tidak ada, master memakai tahun submittedAt sesuai zona waktu. No. Buku memakai counter atomik book:mode:year yang terpisah dari nomor referensi ROI; tahun baru mendapat nomor 1. Nomor bukan ID database dan tidak dihitung ulang saat pencarian/sorting. Baris manual dapat memilih tahun; perubahan invoice_date kustom ke tahun lain memperbarui tahun/nomor dalam satu transaksi beserta jurnal Undo/Redo. Respons PUT cell menyertakan bookRow agar UI mengetahui perpindahan.

GET /admin/custom/export/csv|xlsx menerima year/q/sort/dir yang sama dengan daftar. page/size diabaikan untuk ekspor: seluruh hasil filter diekspor, bukan satu halaman. Pemrosesan 500 baris per batch, indeks sel Map, snapshot transaksi RepeatableRead (SQLite Serializable), CSV/XLSX streaming; tahun dan No. Buku ditambahkan sebagai kolom metadata. Mode tetap dari session, tidak dapat ditimpa query. Pembatalan koneksi menghentikan unduhan.


## Perlindungan simpan bersamaan dan nilai angka (audit lanjutan 16 November 2026)

PUT form/template tetap wajib memakai baseVersionId. Pemeriksaan pointer versi sekarang atomik: jika beberapa permintaan memakai versi awal yang sama, hanya satu yang berhasil; lainnya 409 dan transaksinya dibatalkan tanpa meninggalkan versi sementara. Muat ulang versi aktif dan tinjau perubahan sebelum mencoba lagi.

PUT custom/cell pada kolom number menerima number finite atau string desimal/scientific yang valid (contoh 12.5 atau 1e3), lalu menyimpan number. String kosong tetap mengosongkan sel; boolean, string hanya spasi, heksadesimal dan nilai nonfinite ditolak. Warna saja dapat diubah tanpa mengirim value. Sorting PostgreSQL juga menangani nilai lama yang disimpan sebagai string desimal/scientific tanpa menulis ulang data historis.


## Notifikasi admin

Rute baru berada di /admin/notifications, memerlukan login dan mode session aktif. GET recipients, unread, daftar ?box=inbox|sent&unread=0|1&page=1; POST root untuk membuat; POST :id/read, read-all, :id/cancel untuk baca/batalkan. Semua mutasi memerlukan CSRF. Mode/penerima tidak dapat dilewati dengan ID pesan. Payload, hak akses, jadwal dan migrasi dijelaskan di [NOTIFIKASI_ADMIN.md](NOTIFIKASI_ADMIN.md).

Ringkasan tahunan: GET /api/admin/dashboard?year=current|YYYY (all ditolak), mode dari session. Mengembalikan agregat total/today/last7/vendors/failed, daily[30], monthly[12], currencies (total string desimal per mata uang), topVendors/topByValue, compositions, sources, emails, duration dan followups. GET /api/admin/submissions dan /export/:format menerima followup=legality|email, dikombinasikan dengan filter tahun/pencarian/vendor/tanggal/status. Detail definisi: RINGKASAN_ADMIN.md.
