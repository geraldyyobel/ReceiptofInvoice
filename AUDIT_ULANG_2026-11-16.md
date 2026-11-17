# Audit ulang setelah pembukuan tahunan — 16 November 2026

**Empat kasus bug terkonfirmasi dan sudah diperbaiki.** Suite akhir berhasil **74/74 di PostgreSQL dan 74/74 di SQLite**, build berhasil, dan audit npm seluruh dependensi mencatat **0 kerentanan yang diketahui registry**. Aplikasi lokal sudah dinyalakan kembali di http://localhost:5173.

## Temuan dan perbaikan

| Prioritas | Temuan | Bukti sebelum perbaikan | Perbaikan |
|---|---|---|---|
| P1 | Perubahan Form Builder dapat tertimpa saat dua tab/admin menyimpan dari versi yang sama. | Dalam enam permintaan bersamaan, dua penyimpanan diterima. Pemeriksaan baseVersionId dilakukan saat membaca, kemudian pointer versi ditulis tanpa syarat. | Update pointer sekarang mensyaratkan baseVersionId masih sama secara atomik. Hanya satu penyimpanan berhasil; lainnya 409 dan transaksinya dibatalkan, termasuk versi sementara. |
| P1 | Template dokumen mempunyai celah penyimpanan bersamaan yang sama. | Enam penyimpanan dari versi awal yang sama semuanya diterima sehingga perubahan terakhir menimpa pilihan versi aktif. | Pointer template diperbarui dengan syarat versi awal yang sama; satu berhasil dan lima ditolak 409. Versi/riwayat gagal tidak ditinggalkan. |
| P2 | Sorting PostgreSQL salah untuk angka lama yang disimpan sebagai teks dengan notasi ilmiah. | Nilai teks `1e3` ditempatkan sebagai nol, sehingga muncul sebelum 1 dan 10. | Sorting menerima format desimal/scientific dan memakai konversi numerik terjaga. Kasus angka sangat besar/kecil juga diuji agar tidak menghasilkan error server. Tidak ada penulisan ulang sel lama. |
| P2 | API kolom angka belum menormalisasi tipe dan menerima konversi yang tidak sesuai. | `1e3` tetap disimpan sebagai string; validasi Number(value) juga meloloskan boolean, spasi, dan heksadesimal. | Angka valid disimpan sebagai number; format yang tidak sesuai ditolak. Nilai kosong string tetap boleh untuk mengosongkan sel. Penolakan tidak mengubah nilai/jurnal sebelumnya. |

Kode utama: `server/app.js` (penyimpanan form dan template), `server/custom-query.js` (sorting), dan `server/custom-editing.js` (validasi angka). Tidak ada perubahan skema, migration, pengaturan, kredensial, atau nomor buku yang diperlukan untuk perbaikan ini.

## Bukti pengujian

Suite lama berisi 69 tes tetap lulus pada pemeriksaan awal. Empat kasus tambahan di `tests/review-regressions.test.js` kemudian gagal sebelum perbaikan dan berhasil setelahnya. Angka 74 termasuk parent test sesuai hitungan Node test runner.

| Pemeriksaan akhir | Hasil |
|---|---|
| PostgreSQL, database sementara terpisah | 74 lulus, 0 gagal/dilewati/dibatalkan; sekitar 85,9 detik |
| SQLite, database sementara terpisah | 74 lulus, 0 gagal/dilewati/dibatalkan; sekitar 76,2 detik |
| Regresi baru terarah di PostgreSQL | 5/5 lulus |
| Build Vite serta migration/seed database uji | Berhasil |
| Audit npm produksi dan development | 0 advisori tercatat; CA sistem dipakai tanpa mematikan TLS |

Cakupan lain tetap meliputi login/session/CSRF/role, isolasi mode, master read-only, percabangan dan tanggal, submit serentak/nomor unik, PDF, SMTP/OAuth dengan mock, upload, versi, auto-sinkron, pagination/pencarian, tahun/nomor buku, Undo/Redo, backup/restore dan browser desktop/mobile.

Log lokal dalam `test-results`: `audit-followup-postgresql.log` (baseline 69), `audit-followup-reproduction.log` (kegagalan yang direproduksi), `audit-followup-regressions-fixed.log`, `audit-followup-final-postgresql.log`, `audit-followup-final-sqlite.log`, dan `audit-followup-dependencies.json`.

## Uji data aktif dan performa sesudah perbaikan

Dataset operasional tetap **10.004 master/salinan Internal dan 10.001 Eksternal**, masing-masing mencakup 10.000 demo. Ada 19 kolom per mode dan total 314.286 sel. Pengujian perubahan form, template, angka, dan restore hanya memakai database sementara.

| Operasi | Internal | Eksternal |
|---|---:|---:|
| API 50 baris, median tiga sampel | 59 ms | 97 ms |
| API pencarian tanpa hasil, median tiga sampel | 190 ms | 165 ms |
| API sorting angka, median tiga sampel | 116 ms | 143 ms |
| Browser membuka tabel | 400 ms | 300 ms |
| Pencarian browser, termasuk jeda mengetik | 968 ms | 957 ms |
| CSV: file diterima dan jumlah baris diverifikasi | 2,68 dtk / 10.004 baris | 3,26 dtk / 10.001 baris |
| XLSX: file diterima dan jumlah baris diverifikasi | 3,94 dtk / 10.004 baris | 4,12 dtk / 10.001 baris |

Semua health check paralel selama ekspor berhasil; latensi tertinggi yang teramati 113 ms. Tidak ada error JavaScript teramati pada skenario browser. Permintaan tabel browser tetap size=50, tanpa all=1. Hasil mentah: `test-results/audit-followup-performance.json`. Ini tiga sampel per kueri dan satu pengukuran ekspor/browser per skenario, bukan P95 atau simulasi banyak pengguna bersamaan.

Pemeriksaan keutuhan membandingkan sidik master, salinan, kolom, sel dan view dengan salinan sebelum migrasi tahunan, mengabaikan kolom metadata buku yang memang ditambahkan sebelumnya. Rincian status health, penolakan akses tanpa login dan jumlah data: `test-results/audit-followup-final-health.json`. Login/logout dan ekspor pemeriksaan tercatat seperti penggunaan normal.

## Batas kesimpulan

Seluruh skenario tes akhir berhasil. Pengujian ini tidak menjamin aplikasi bebas seluruh bug. SMTP/OAuth dengan akun nyata, deployment HTTPS, runtime Docker, MySQL, beban banyak pengguna dan audit penetrasi independen tidak diuji pada sesi ini. Audit npm hanya mencakup advisori dependensi yang diketahui, bukan keamanan seluruh sistem/infrastruktur. Backup dan restore diuji pada database terpisah; database operasional tidak direstore.

Untuk mengulang: jalankan `npm.cmd run test:postgres` atau tes khusus `npm.cmd run test:postgres -- tests/review-regressions.test.js`. `npm.cmd test` menguji SQLite lalu mengembalikan client ke provider runtime; hentikan server sebelum perintah ini pada Windows. Alat performa aplikasi aktif: `npm.cmd run test:custom-performance`.
