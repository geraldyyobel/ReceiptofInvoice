# PostgreSQL dan data uji — 13 November 2026

Instalasi lokal sudah memakai **PostgreSQL 17.5**, database **roi_bcu** pada **127.0.0.1:5543**. Ini instance khusus proyek di `data/postgresql`, terpisah dari layanan PostgreSQL lain yang sudah ada di komputer. Role aplikasi `roi_bcu` bukan superuser dan tidak diberi izin membuat role/database lain.

## Membuka aplikasi

Di PowerShell biasa, dari folder proyek:

```powershell
npm.cmd start
```

Buka <http://localhost:5173/admin>. Akun admin dan password lama tetap berlaku; sesi lama perlu login ulang. Perintah start memastikan instance PostgreSQL lokal sudah aktif, lalu menjalankan aplikasi. Setelah komputer menyala kembali, jalankan perintah ini lagi dan biarkan terminal tetap terbuka. Port aplikasi ditetapkan pada PORT=5173; mode pengembangan memakai API_PORT=3000 dan Vite 5173.

PostgreSQL harus tetap menyala untuk melayani database. Pengaturan dan password koneksi tersimpan di `.env`. Konfigurasi pengelola instance disimpan terenkripsi pada `data/postgresql-local.enc` menggunakan ENCRYPTION_KEY yang sudah ada. Jangan mengganti/menghilangkan ENCRYPTION_KEY: password SMTP dan arsip backup lama juga menggunakannya.

## Data yang dapat diuji

| Mode | Data lama | Data uji baru | Total master | Total salinan kustom |
|---|---:|---:|---:|---:|
| Internal | 4 | 10.000 | 10.004 | 10.004 |
| Eksternal | 1 | 10.000 | 10.001 | 10.001 |

Vendor data uji diawali **[DATA UJI]**, nomor invoice memuat **INV-UJI**, dan nomor referensi diawali **UJI-INT** atau **UJI-EKS**. Cari `data uji` pada Data Form; pencarian tetap tidak peka huruf besar/kecil setelah pindah ke PostgreSQL. Data bervariasi dalam vendor, mata uang, nominal, tanggal, PPN, jasa, legalitas, dan subvendor menurut definisi form aktif masing-masing mode. Nilai tersembunyi disingkirkan melalui mesin validasi yang sama dengan form publik.

Data uji tidak memakai nomor urut invoice asli. Susunan, nama, visibilitas, warna, nilai baris lama dan view tabel kustom dipertahankan; kolom baru tidak dibuat ulang oleh seed jika admin sudah mengatur tabel. Kolom kustom tambahan dapat tetap kosong seperti saat form vendor masuk normal.

Tidak ada email yang dikirim oleh seeding. Jika menguji pengiriman sendiri, pastikan tujuan email adalah alamat pengujian yang Anda inginkan, terutama karena opsi email Internal memakai daftar yang diatur admin.

Program seeding dapat dilanjutkan dengan:

```powershell
npm.cmd run demo:add
```

Perintah ini melanjutkan batch yang sama dan tidak menggandakan 10.000 baris yang sudah selesai. Pengaturan batch berada pada Settings internal `demo_data_active_batch`, termasuk jumlah yang sudah ditambahkan. Tidak ada seed otomatis saat aplikasi dinyalakan.

## Membersihkan data uji sesudah selesai

Hentikan aplikasi dengan Ctrl+C dan buat backup bila diperlukan. Perintah berikut menghapus **hanya batch data uji** yang ditandai oleh script:

```powershell
npm.cmd run demo:remove
```

Penghapusan membutuhkan penanda ID, vendor dan nomor referensi yang konsisten. Salinan sel/baris demo ikut dihapus; data lama dan susunan kolom dipertahankan. Riwayat Undo/Redo yang menyentuh demo dibersihkan agar data demo tidak dimunculkan kembali. Log aktivitas dan arsip backup lama dipertahankan untuk audit; backup lama dapat masih mengandung data demo sampai retensi berakhir. Setelah pembersihan, script tidak otomatis membuat batch baru.

## Data lama dan pemulihan

Migrasi dilakukan setelah membuat backup pengaman. SQLite lama tetap ada di `data/roi.db`. Ekspor migrasi terenkripsi tersedia di `data/migrations/sqlite-before-postgresql.enc` dan konfigurasi lama disimpan terenkripsi di folder yang sama. Semua 22 kelompok tabel yang disalin telah dibandingkan dengan sumber, termasuk akun, form/versi, ketentuan, template, master, jawaban, tabel kustom, history, upload, log, backup, counter dan settings. Tidak ada sesi login yang disalin.

Jangan sekadar mengarahkan aplikasi kembali ke file SQLite setelah mulai menerima data baru di PostgreSQL: file lama tidak memuat perubahan baru tersebut. Pemulihan perlu mempertimbangkan data yang ditambahkan sesudah migrasi. Arsip backup aplikasi tetap berupa dump logis Prisma + upload terenkripsi dan mendukung database aktif PostgreSQL.

## Pengujian dan batas hasil

```powershell
npm.cmd run test:postgres
```

Perintah memakai database PostgreSQL sementara yang terpisah; tidak mengosongkan database aplikasi atau mengirim email nyata. Pemeriksaan 16 November: **82 tes lulus**, meliputi role/session/CSRF, percabangan, tanggal, submit serentak, tabel kustom/Undo/Redo, dokumen/PDF, mock SMTP/OAuth, backup/restore, browser desktop/mobile dan kegagalan penyimpanan browser setelah submit. Untuk tes regresi terarah: `npm.cmd run test:postgres -- tests/public-storage.test.js`. `npm test` tetap menguji SQLite secara terisolasi lalu mengembalikan client Prisma ke provider runtime; hentikan server sebelum generate Prisma pada Windows.

Pengukuran awal 16 November menemukan pencarian kustom melebihi 15 detik. Setelah optimasi: sekitar 0,9–1 detik di browser, payload halaman 141/183 KB, dan ekspor CSV/XLSX 2,4–4 detik pada data aktif 10.004 Internal dan 10.001 Eksternal. Data lama tetap utuh. Pembukuan sekarang mengikuti tahun tanggal invoice dengan nomor tersimpan yang dimulai dari 1 per mode/tahun. Rincian: [PERBAIKAN_TABEL_TAHUNAN_2026-11-16.md](PERBAIKAN_TABEL_TAHUNAN_2026-11-16.md).

Optimasi Tabel Kustom dilakukan setelah migrasi database; hasil lama tetap disimpan sebagai baseline. Ukur aplikasi aktif dengan npm.cmd run test:custom-performance. Script test:volume lama adalah benchmark historis khusus SQLite dan asumsi API all=1 lama; gunakan alat baru untuk API pagination saat ini. Pengujian belum mensimulasikan banyak pengguna bersamaan.

## Instalasi baru dan Docker

Untuk instalasi lokal Windows baru, pasang PostgreSQL 17, sesuaikan LOCAL_POSTGRES_BIN jika lokasi berbeda, lalu jalankan npm ci, npm run setup, npm run browser:install dan npm run build. Setup membentuk rahasia acak; bila LOCAL_POSTGRES_DIR diisi, bootstrap membuat instance khusus proyek dan menyelaraskan konfigurasi koneksi. Untuk PostgreSQL remote, kosongkan LOCAL_POSTGRES_DIR dan isi DATABASE_URL yang sesuai.

Docker Compose kini menyediakan PostgreSQL 17 dengan role aplikasi non-superuser dan volume `roi_pg_data`. Port database Docker default 5544 agar tidak bentrok dengan instance Windows 5543. Isi POSTGRES_PASSWORD dan POSTGRES_ADMIN_PASSWORD dengan nilai acak; setup dapat membuatnya dari contoh konfigurasi. Docker adalah instance/database lain: data lokal Windows tidak otomatis disalin ke sana. Konfigurasi Compose telah divalidasi; image/runtime Docker belum dibangun ulang pada sesi ini. Mode production memerlukan reverse proxy HTTPS yang sesuai APP_ORIGIN untuk cookie Secure.


Audit lanjutan 16 November 2026: empat kasus tambahan diperbaiki pada simpan form/template bersamaan dan angka kustom; suite penuh PostgreSQL dan SQLite masing-masing 74/74 lulus. Perbaikan tidak membutuhkan migration atau perubahan data lama. Lihat [AUDIT_ULANG_2026-11-16.md](AUDIT_ULANG_2026-11-16.md).


Pembaruan notifikasi admin menambahkan migration 202611160002_admin_notifications dan dua tabel baru. Pesan/pengingat serta status baca masuk backup; arsip lama tetap dapat direstore. Cara penggunaan: [NOTIFIKASI_ADMIN.md](NOTIFIKASI_ADMIN.md).
