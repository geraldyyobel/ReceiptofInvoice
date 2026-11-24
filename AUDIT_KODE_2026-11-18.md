# Audit dan menjalankan aplikasi — 18 November 2026

Aplikasi lokal dinyalakan pada http://localhost:5173 dengan PostgreSQL. Database sempat berhenti tanpa shutdown bersih; log PostgreSQL menunjukkan pemulihan WAL otomatis selesai dan database siap menerima koneksi. Penyebab penghentian Windows sebelumnya tidak dipastikan dalam audit ini. Tidak melakukan reset, seed ulang, atau restore pada data aktif.

## Bug yang direproduksi dan diperbaiki

1. Konfigurasi Gmail ikut membaca MICROSOFT_TENANT_ID. Tenant Microsoft yang khusus organisasi membuat penyimpanan kredensial Gmail identik dianggap berubah dan dapat memutus akun. Tenant Gmail sekarang terpisah dan tetap common secara internal; endpoint Google tidak memakai tenant Microsoft.
2. Dua admin menyimpan konfigurasi bersamaan: penyimpanan dengan secret kosong membaca secret lama sebelum transaksi. Jika admin lain merotasi secret lebih dulu, secret lama dapat tersimpan kembali. Pembacaan nilai saat ini dipindahkan ke dalam transaksi setelah memperoleh kunci provider.
3. Callback login lama dapat mengembalikan koneksi akun setelah perubahan kredensial yang berlangsung bersamaan. Validasi dan penyimpanan callback sekarang memakai kunci transaksi provider yang sama dengan simpan konfigurasi dan putus koneksi. Perubahan konfigurasi dan penyimpanan akun diurutkan pada database, berlaku lintas proses server.

Kunci memakai baris Settings privat berawalan mail_oauth_lock_, tidak membutuhkan migration. Status/Settings umum tetap menyembunyikan data privat dan secret tetap terenkripsi. Uji menahan transaksi/respons untuk mereproduksi urutan yang bermasalah; ketiga uji gagal sebelum perbaikan dan lulus setelahnya.

## Pemeriksaan

- Baseline tes lama: 101/101 lulus. Bukti: test-results/audit-2026-11-18-baseline.log.
- Tes OAuth setelah perbaikan: 16/16 lulus. Bukti: test-results/audit-2026-11-18-oauth-after.log. Reproduksi gagal: audit-2026-11-18-oauth-before.log.
- Suite akhir seluruh aplikasi: **105/105 lulus**, 0 gagal. Bukti: test-results/audit-2026-11-18-final.log.
- Pemeriksaan sintaks modul OAuth dan git diff --check lulus. Build frontend dijalankan oleh runner tes.
- Health, konfigurasi publik, admin dan kedua form publik HTTP 200 pada aplikasi yang sudah dijalankan ulang. Smoke browser live: Ringkasan/Data Form normal, halaman master dan kustom masing-masing 20 baris, kolom OAuth terlihat, secret kosong dan tidak ada pageerror. Bukti: test-results/audit-2026-11-18-live.json.
- SHA-256 sembilan tabel bisnis (master/nilai, kolom/baris/sel/view kustom, notifikasi/penerima, email log) sama sebelum/sesudah restart dan pemeriksaan. Bukti privat: data/runtime/audit-2026-11-18-business-before.json dan audit-2026-11-18-business-after.json. Data/folder ini tidak masuk Git/ZIP.
- Tes menggunakan database/folder sementara, tidak mengirim email nyata atau mengubah status baca pesan operasional.

## Temuan dependensi yang masih terbuka

Audit seluruh paket menghasilkan **4 peringatan high**: picomatch, fdir, tinyglobby, dan vite. Keempatnya berasal dari satu akar advisori picomatch [GHSA-fc5q-39xc-vjpf](https://github.com/advisories/GHSA-fc5q-39xc-vjpf), tentang pola glob yang dapat menyebabkan ReDoS. Database advisori menyatakan belum ada versi patch; npm registry saat pemeriksaan menyediakan picomatch 4.0.7. Saran otomatis npm menurunkan Vite ke 6.2.7 adalah perubahan mayor mundur dan tidak diterapkan karena dapat merusak kompatibilitas plugin/build serta bukan patch picomatch.

`npm audit --omit=dev` menghasilkan **0 advisori runtime**. Ini klasifikasi dependensi, bukan jaminan seluruh deployment aman: Dockerfile saat ini memasang dependensi build juga. Aplikasi yang dijalankan memakai Node/Express dan dist hasil build, bukan Vite dev server; jangan menafsirkan ini sebagai kerentanan upstream sudah diperbaiki. Bukti: test-results/audit-2026-11-18-dependencies.json dan audit-2026-11-18-runtime-dependencies.json. Versi paket tidak diubah untuk menyembunyikan peringatan.

## Batas pemeriksaan

Konfigurasi yang diuji adalah PostgreSQL lokal. OAuth/SMTP/provider email diuji dengan simulasi, bukan akun/mailbox eksternal nyata. Tidak ada jaminan bebas bug di setiap kondisi, dan tidak ada uji beban jangka panjang banyak pengguna atau build/run Docker dalam audit ini.
