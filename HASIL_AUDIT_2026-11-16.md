# Pemeriksaan aplikasi — 16 November 2026

**Aplikasi berjalan dan tes fungsi lulus, tetapi Tabel Kustom belum lancar pada 10.000 baris per mode.** Satu bug pada keberhasilan submit diperbaiki. Dua hambatan performa kustom tetap perlu ditangani sebelum volume ini dipakai rutin.

## Temuan menurut prioritas

| Prioritas | Temuan dan dampak | Bukti | Status |
|---|---|---|---|
| P1 | Pencarian kustom memindai daftar sel berulang untuk setiap baris/kolom. Browser dapat tidak merespons ketika admin mengetik. UI juga mengunduh seluruh tabel walau hanya menampilkan 50 baris. | `client/src/custom.jsx:24`, `:51`, `:170–193`. Pada PostgreSQL aktif, pencarian istilah yang tidak ada tidak selesai dalam 15 detik, pada kedua mode. Payload Internal 26.22 MB dan Eksternal 36.45 MB, diminta ulang saat polling yang diizinkan. | Belum diperbaiki pada audit ini. |
| P1 | Ekspor kustom memfilter seluruh daftar sel untuk setiap baris dan mencari ulang sel untuk pewarnaan. Pekerjaan sinkron ini juga dapat menahan permintaan lain dalam proses server yang sama. | `server/app.js:1093–1114`. Algoritma masih sama dengan yang melewati 30 detik pada uji volume SQLite 13 November. Ekspor volume penuh tidak dijalankan ulang pada server PostgreSQL operasional agar tidak menahannya; durasi PostgreSQL tidak diklaim. Ekspor kecil dan warna XLSX lulus tes integrasi. | Belum diperbaiki; temuan kode dan hasil historis dibedakan dari pengukuran saat ini. |
| P2 | Sesudah server membalas 201, kegagalan `sessionStorage.setItem` atau `localStorage.removeItem` masuk ke penanganan gagal submit sebelum halaman sukses. Invoice sudah tercatat, tetapi pengguna dapat menekan Kirim lagi. | Dua tes browser sebelum perbaikan membuktikan respons server 201 dan halaman sukses tidak muncul. Ini risiko kirim ulang; bukan klaim sudah terjadi duplikasi pada data pengguna. | Diperbaiki di `client/src/public.jsx`. |

Perbaikan submit menampilkan keberhasilan berdasarkan respons server; operasi penyimpanan browser ditangani terpisah. Pengguna mendapat pengingat untuk mengunduh dokumen dan menyimpan nomor referensi bila penyimpanan gagal. Mengisi invoice baru dan menghapus draft dapat memulai form kosong tanpa bergantung pada keberhasilan penghapusan penyimpanan browser.

Tes regresi `tests/public-storage.test.js` memaksa kedua kegagalan secara terpisah dan memeriksa: respons 201, halaman sukses, nomor referensi sesuai server, hanya satu submission untuk invoice fixture, unduhan PDF tetap berhasil, dan pengisian baru dimulai kosong. Tes memakai database sementara, bukan data operasional.

## Hasil tes akhir

- `npm.cmd run test:postgres`: **60 lulus, 0 gagal, 0 dibatalkan, 0 dilewati**, durasi tes sekitar 63 detik. Migrasi/seed database sementara dan build Vite juga berhasil.
- Cakupan: percabangan dan pembersihan nilai tersembunyi, batas tanggal, total, submit serentak/nomor unik, login/session/CSRF/role, isolasi mode, master read-only, auto-sinkron, Undo/Redo/konflik, CRUD dan versi form/ketentuan/template, upload, PDF, SMTP dan OAuth dengan mock, backup/restore, browser desktop/mobile, dan kegagalan penyimpanan browser.
- Audit npm mencakup dependensi produksi dan pengembangan: **0 kerentanan tercatat**. CA sistem dipakai; verifikasi TLS tetap aktif. Hasil hanya mencakup advisori yang diketahui registry saat pemeriksaan.
- Tes regresi terarah: `npm.cmd run test:postgres -- tests/public-storage.test.js`. Runner tetap membuat database sementara; pilihan dibatasi pada file tes yang terdaftar.

Log bukti lokal: `test-results/postgres-final-2026-11-16.log`, `storage-reproduction-2026-11-16.log` dan `storage-fixed-2026-11-16.log`. Log reproduksi terarah menunjukkan kedua kegagalan sebelum perbaikan; log akhir menunjukkan semuanya lulus.

## Pemeriksaan aplikasi dan data aktif

PostgreSQL lokal di port 5543; aplikasi di `http://localhost:5173`. Beranda, Internal, Eksternal, Admin dan health HTTP 200. API admin tanpa login HTTP 401, dokumen master dari mode lain HTTP 404, dan konfigurasi publik tidak mengandung kunci SMTP/password/OAuth/token.

| Pemeriksaan | Internal | Eksternal |
|---|---:|---:|
| Master / salinan kustom | 10.004 / 10.004 | 10.001 / 10.001 |
| Data demo yang sudah ada | 10.000 | 10.000 |
| Master 50 baris pertama | 24 ms | 26 ms |
| Master halaman 200 | 34 ms | 63 ms |
| Cari `data uji` huruf kecil, hasil 10.000 | 34 ms | 59 ms |
| API kustom 50 baris | 69 ms | 122 ms |
| API seluruh kustom lewat Fetch | 2.48 dtk / 26.22 MB | 3.30 dtk / 36.45 MB |
| Browser kustom siap | 4.76 dtk | 2.76 dtk |
| Browser mencari istilah tanpa hasil | >15 dtk, batas uji | >15 dtk, batas uji |

Ukuran MB desimal. Ini satu pengukuran per skenario, bukan rata-rata/P95 atau uji banyak pengguna bersamaan. Chromium uji memakai batas heap renderer 512 MiB pada komputer yang sama. Tidak ada error JavaScript yang teramati selama skenario volume; responsivitas pencarian tetap gagal memenuhi batas uji.

Pembaca HTTP Superagent pada smoke test awal melewati 20 detik ketika membaca payload penuh. Pengujian ulang memakai Fetch, seperti aplikasi, membuktikan kedua endpoint HTTP 200 dan durasi di tabel. Timeout alat pembaca itu tidak dinyatakan sebagai kegagalan endpoint server. Hasil mentah disimpan terpisah agar perbedaannya dapat diperiksa: `test-results/runtime-2026-11-16.json`, `runtime-payload-2026-11-16.json`, dan `browser-volume-2026-11-16.json`.

Tidak ada submission operasional yang ditambah/dihapus oleh tes. Jumlah master/salinan dan 20.000 demo tetap dipertahankan. Login/logout/mode pemeriksaan tercatat di log sebagaimana perilaku aplikasi. Startup aplikasi membuat satu backup pengganti slot 00:00 yang terlewat; jadwal tetap 00:00 dan 12:00 Asia/Jakarta, dan seluruh catatan backup saat diperiksa berstatus selesai.

## Urutan perbaikan berikutnya

1. Terapkan pencarian, pengurutan dan pagination kustom di server; polling mengambil perubahan yang diperlukan, bukan seluruh tabel.
2. Gunakan indeks sel `Map` per baris/kolom untuk render dan ekspor; ekspor besar dijalankan bertahap atau melalui pekerjaan terpisah agar tidak menahan server.
3. Uji ulang kedua mode pada 10.000 baris, termasuk pencarian, ekspor dan permintaan lain saat ekspor; ukur latensi beberapa kali dan penggunaan memori.

Tidak ada klaim aplikasi bebas seluruh bug. SMTP/OAuth dengan akun nyata, deployment HTTPS, runtime Docker, pengujian penetrasi independen, MySQL dan beban banyak pengguna tidak diuji pada sesi ini. Backup/restore penuh diuji pada database terpisah, bukan dengan memulihkan database operasional.
