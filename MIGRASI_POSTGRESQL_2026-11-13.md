# Migrasi PostgreSQL dan data acak — 13 November 2026

Migrasi selesai dan aplikasi aktif di http://localhost:5173. PostgreSQL 17.5 khusus proyek menggunakan 127.0.0.1:5543/database roi_bcu dengan role aplikasi non-superuser. Layanan PostgreSQL lain di komputer tidak diubah.

## Data

| Mode | Data lama | Data baru berlabel DATA UJI | Total master | Total kustom |
|---|---:|---:|---:|---:|
| Internal | 4 | 10.000 | 10.004 | 10.004 |
| Eksternal | 1 | 10.000 | 10.001 | 10.001 |

Batch PG20261113-46b16d menghasilkan vendor, nominal, mata uang, tanggal, PPN, jasa, legalitas dan subvendor acak yang lolos mesin validasi form aktif. Nomor referensi diawali UJI-INT/UJI-EKS dan invoice memuat INV-UJI; urutan nomor invoice asli tidak dipakai atau dinaikkan. Masing-masing submission disalin ke tabel kustom tanpa menimpa sel/baris/warna/kolom/view lama.

## Verifikasi

- Backup pengaman dan ekspor migrasi terenkripsi dibuat sebelum pergantian provider. SQLite asli dan konfigurasi lama tetap tersimpan.
- Import PostgreSQL dilakukan ke database kosong dalam transaksi. Semua kelompok tabel dibandingkan ke sumber, termasuk hash password, settings terenkripsi, versi form/ketentuan/template, master/jawaban, tabel kustom, history, upload/log/backup/counter. Pemeriksaan sesudah seeding membuktikan seluruh baris lama masih sama. Sesi lama sengaja tidak disalin.
- **57/57 tes lulus pada PostgreSQL**, termasuk browser, JSON/HTML/PDF, autentikasi/role/CSRF, validasi/percabangan, sinkron, Undo/Redo, backup/restore dan mock email/OAuth. Database tes sementara terpisah dan dibersihkan setelah tes.
- Pencarian teks PostgreSQL tetap tidak peka huruf besar/kecil seperti pengalaman sebelumnya. API dan browser nyata berhasil mencari data uji dengan kata data uji, menampilkan 10.000 hasil pada masing-masing mode.
- API master/kustom memverifikasi total 10.004/10.001; role database aplikasi bukan superuser. Health aplikasi HTTP 200. Screenshot Data Form tersimpan di test-results/postgresql-demo-internal.png dan postgresql-demo-eksternal.png.
- Native startup menggunakan PostgreSQL lokal yang sudah aktif; npm start juga menyediakan pemeriksaan/start instance jika belum berjalan. Compose PostgreSQL telah divalidasi dengan docker compose config --quiet, tetapi image/runtime Docker tidak dibangun ulang.

## Batas dan operasi

Ini pemindahan provider serta penyediaan data untuk pengujian manual, bukan optimasi algoritma pencarian/ekspor tabel kustom. Hambatan pada laporan volume sebelumnya belum dinyatakan selesai. Email tidak dikirim saat seed; akun admin lama tetap. Panduan mulai, penanda batch, penghapusan data uji yang aman dan pemulihan tersedia pada POSTGRESQL.md. Tidak ada penghapusan data operasional atau pergantian kunci aplikasi.
