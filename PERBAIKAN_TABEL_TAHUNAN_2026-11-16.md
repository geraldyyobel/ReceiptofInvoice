# Tabel Kustom dan pembukuan tahunan — 16 November 2026

**Selesai:** pemuatan per halaman, pencarian/pengurutan server, indeks sel, ekspor bertahap, dan pembukuan menurut **tanggal invoice**. Aplikasi lokal kembali berjalan di http://localhost:5173.

## Cara memakai pembukuan

- Di **Data Form** atau **Tabel Kustom**, pilih **Tahun buku**. Default **Tahun berjalan** mengikuti zona waktu Settings. Tahun lama tetap dapat dibuka; **Semua tahun** menampilkan kelompok tahun.
- **No. Buku** disimpan tetap, dimulai dari 1 untuk setiap mode/tahun. Nomor tidak berubah karena pencarian, sorting atau pindah halaman. ID unik database dan nomor referensi ROI yang sudah terbit dipertahankan.
- Contoh: invoice 2026-12-31 masuk buku 2026; invoice pertama 2027-01-01 mendapat nomor buku 1 pada mode yang bersangkutan. Tanggal penerimaan form tidak mengubah tahun invoice tersebut.
- Master dan salinan awal mendapat nomor buku yang sama. Baris manual memakai rangkaian nomor yang sama, sehingga pada master dapat ada celah nomor yang dipakai baris manual. Nomor yang dihapus/dibatalkan tidak dipakai ulang; counter tidak dimundurkan oleh Undo atau pembersihan demo.
- Jika tanggal invoice tidak ada, master memakai tahun penerimaan. Baris manual memakai tahun yang dipilih. Koreksi tanggal invoice di salinan kustom ke tahun lain memindahkan baris dan memberi nomor di buku tujuan; tanggal serta perpindahan bisa di-Undo/Redo sebagai satu langkah. Master tetap utuh. Mengosongkan tanggal salinan master mengembalikannya ke tahun penerimaan.
- CSV/XLSX mengekspor **seluruh hasil filter tahun dan pencarian**, termasuk halaman berikutnya. Pilih Semua tahun untuk ekspor lintas tahun. Tahun dan nomor buku ikut diekspor; warna XLSX dan perlindungan formula tetap ada.

## Perubahan implementasi

1. `GET /api/admin/custom` kini membatasi ukuran halaman (default 50, maksimum 100). `all=1` tidak lagi mengambil seluruh tabel. Respons hanya memuat baris dan sel pada halaman tersebut, dengan total/daftar tahun. Pencarian tidak peka kapital, karakter wildcard diperlakukan literal, sorting angka dilakukan sebelum pagination, dan penentu urutan tambahan menjaga stabilitas.
2. Kueri pencarian/sorting memakai SQL berparameter melalui Prisma; identifier ditentukan modul, bukan input pengguna. Mode selalu dari session. Input tahun, ukuran, pencarian dan kolom sort diperiksa.
3. Frontend menunda pencarian 300 ms saat mengetik, memakai indeks `Map` untuk sel, dan menolak respons lama yang tiba belakangan. Polling hanya memuat halaman aktif, berhenti ketika mengedit, dan tidak menimpa perubahan yang masih dikirim.
4. Ekspor kustom memakai batch 500 baris, indeks sel satu lintasan, serta writer CSV/XLSX streaming. Snapshot transaksi menjaga isi konsisten selama ekspor; proses memberi kesempatan permintaan lain berjalan di antara batch. Ekspor arsip memakai indeks sel yang sama, sehingga tidak lagi memfilter seluruh sel untuk setiap baris.
5. Sinkronisasi otomatis hanya mencari masterId dari submission yang sedang ditambahkan, tidak membaca seluruh daftar masterId kustom setiap kali satu form masuk. Edit, warna, kolom, view dan Undo/Redo tetap dipertahankan.

## Hasil pada database aktif PostgreSQL

Dataset: **10.004 Internal + 10.001 Eksternal**, masing-masing memuat 10.000 demo, 19 kolom per mode, total 314.286 sel. Dataset sama dengan pemeriksaan awal PostgreSQL pada hari ini. Ukuran KB/MB desimal.

| Operasi | Internal | Eksternal |
|---|---:|---:|
| Payload halaman sebelumnya | 26,22 MB | 36,45 MB |
| Payload halaman sekarang | 140,8 KB | 183,0 KB |
| API halaman, median 3 sampel | 49 ms | 53 ms |
| API pencarian tanpa hasil, median 3 sampel | 243 ms | 218 ms |
| API sorting angka, median 3 sampel | 114 ms | 87 ms |
| Browser: tabel siap setelah menu dibuka | 398 ms | 315 ms |
| Browser: pencarian sebelumnya | >15 dtk, batas uji | >15 dtk, batas uji |
| Browser: pencarian sekarang, termasuk debounce | 988 ms | 911 ms |
| Ekspor CSV, termasuk menerima file | 2,41 dtk | 2,81 dtk |
| Ekspor XLSX, termasuk menerima file | 3,50 dtk | 4,02 dtk |
| Baris data ekspor diverifikasi | 10.004 | 10.001 |

Selama keempat ekspor, seluruh pemeriksaan health paralel berhasil. Latensi health tertinggi yang teramati **129 ms**. Tidak ada error JavaScript teramati dalam pengukuran browser; permintaan browser semuanya memakai `size=50` dan tidak memakai `all=1`.

Ini tiga sampel per kueri dan satu ekspor/browser per skenario pada komputer lokal, bukan P95, uji banyak pengguna bersamaan, atau jaminan kapasitas tak terbatas. Chromium memakai batas heap renderer 512 MiB. Kegagalan ekspor >30 detik pada laporan 13 November berasal dari fixture SQLite 32 kolom; tidak diperlakukan sebagai pengukuran awal PostgreSQL dengan 19 kolom.

Hasil mentah baseline setelah pembukuan: `test-results/custom-performance-before-followup.json`. Ukur ulang setelah aplikasi dinyalakan:

```powershell
npm.cmd run test:custom-performance
```

Alat ini hanya membaca data bisnis; login/logout/ekspor dicatat seperti pemakaian biasa. File ekspor sementara berada di DATA_DIR/performance-downloads dan dihapus setelah diverifikasi. Tidak mengirim email.

## Pengujian fungsi dan kompatibilitas

- Suite penuh **69/69 lulus pada PostgreSQL**, dan **69/69 pada SQLite**, termasuk alur vendor/admin, PDF, email mock, auth/CSRF/role, upload, auto-sinkron, Undo/Redo, backup/restore dan kasus baru pembukuan.
- Pengujian terarah akhir PostgreSQL **10/10 lulus** setelah penambahan perilaku tanggal kosong dan pemeriksaan browser tambahan. Browser menguji tahun 2088, 61 baris lintas dua halaman, pencarian baris halaman lain, respons pencarian yang sengaja dilambatkan, serta kelompok 2088/2026 pada halaman yang sama.
- Tes server mencakup nomor kembali 1 per mode/tahun berdasarkan tanggal invoice, master tetap utuh saat koreksi salinan, pagination stabil/capping, pencarian literal dan isolasi mode, input SQL berbahaya, sorting angka, ekspor lintas halaman/warna, backfill data/jurnal lama yang idempoten, dan restore arsip yang belum mempunyai kolom buku tahunan.
- MySQL disertai migration dan jalur kueri yang sesuai, tetapi tidak dijalankan pada sesi ini. Docker runtime dan akun email nyata juga tidak diuji ulang.

Log: `annual-postgresql.log`, `annual-sqlite.log`, `annual-acceptance-final.log` dalam test-results. Screenshot fixture: `annual-custom-browser.png`.

## Migrasi dan keutuhan data

Sebelum perubahan dibuat backup terenkripsi dan sidik data. Migration **202611160001_annual_books** menambah bookYear/bookNumber nullable serta indeks, tanpa mengganti ID. Backfill mengisi nomor lama menurut urutan waktu penerimaan dan ID sebagai penentu urutan tetap; counter disimpan atomik per mode/tahun. Nullable diperlukan agar arsip sebelum fitur ini bisa dimasukkan lalu dilengkapi saat restore.

Perbandingan sebelum/sesudah membuktikan isi **20.005 master, 20.005 baris salinan, 314.286 sel, 38 kolom dan 1 view identik** selain metadata buku baru. Nomor referensi, jawaban, tanggal, warna, susunan dan visibilitas tidak diganti. Satu jurnal Undo/Redo tetap ada dan metadata snapshot lama ditingkatkan; arsip backup standar memang mengecualikan jurnal, sehingga pemeriksaan data aktif hanya membandingkan jumlah jurnal. Kompatibilitas isi jurnal lama dibuktikan melalui fixture terpisah. Hasil: `test-results/annual-data-integrity.json`.

Seluruh data aktif sekarang masuk buku 2026 sesuai tanggal invoice yang tersimpan. Tahun lain otomatis tersedia setelah ada invoice/baris pada tahun itu. Tidak ada baris demo baru yang ditambahkan ke database aktif selama pengujian ini. Jadwal backup tetap 00:00 dan 12:00 Asia/Jakarta.

Instalasi lain yang sudah memakai versi sebelumnya perlu menghentikan server, membuat backup, menjalankan db:prepare, db:migrate, build, lalu start. Start dan restore memeriksa backfill yang diperlukan. Nomor buku belum ada di arsip sebelum fitur ini dan direkonstruksi saat restore; ID dan nomor ROI lama tetap dipertahankan.
