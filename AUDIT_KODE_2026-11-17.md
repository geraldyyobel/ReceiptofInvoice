# Audit kode 17 November 2026

Hasil: ditemukan bug nyata, diperbaiki, dan seluruh **97 tes PostgreSQL lulus** setelah perbaikan. Hasil ini bukan jaminan tidak ada bug di seluruh kemungkinan pemakaian.

## Temuan yang diperbaiki

| Temuan | Sebelum | Perbaikan |
| --- | --- | --- |
| Hasil pencarian Data Form datang tidak berurutan | Respons pencarian lama menimpa hasil filter terbaru. | Cleanup permintaan menandai respons lama tidak aktif; hanya respons filter aktif yang boleh mengubah hasil. |
| Error dari pencarian lama | Error 503 dari filter yang sudah ditinggalkan tetap muncul di halaman filter baru. | Penanganan error memakai pengaman yang sama. |
| Perpindahan Activity Log ke Email Log | Respons Activity Log yang lambat mengganti isi tabel Email Log, sehingga penerima hilang/kosong. | Respons tab/filter lama diabaikan; tabel dibersihkan saat kueri berganti. Muat ulang setelah backup memakai state refresh pada tab aktif. |
| Logout serentak | 2 dari 12 permintaan uji menghasilkan HTTP 500 karena session sudah dihapus permintaan lain. | Penghapusan session menggunakan deleteMany; logout berulang tetap 200, session lama tidak berlaku dan activity log tidak digandakan. |
| Login serentak dengan session lama sama | Salah satu dari dua login menghasilkan HTTP 500 saat mengganti session lama yang sudah dihapus. | Penghapusan session lama aman diulang; kedua session baru diuji valid dan cookie tetap httpOnly. |

Bukti reproduksi sebelum perbaikan ada di test-results/audit-ui-races-before.log dan audit-auth-races-before.log. Seluruh lima skenario gagal sebelum perbaikan, kemudian lulus. Tes tambahan memastikan daftar backup tetap dimuat ulang setelah tombol Backup sekarang selesai; permintaan backup pada tes browser disimulasikan.

## Pemeriksaan

- Baseline sebelum uji baru: 89/89 lulus. Ini menunjukkan mengapa mengulang tes lama saja tidak cukup untuk membuktikan bebas bug.
- Suite akhir: **97/97 lulus**, 0 gagal, termasuk submit/form/percabangan, isolasi mode, auth/CSRF/role, CRUD dan konflik versi, buku tahunan, tabel kustom/Undo/Redo/ekspor, notifikasi/carousel, Ringkasan, PDF, email/OAuth simulasi, backup/restore pada database uji dan regresi baru.
- Build Vite berhasil; pemeriksaan sintaks JavaScript server/shared/scripts dan git diff --check lulus.
- npm audit semua dependensi: **0 advisori** pada saat pemeriksaan. Sertifikat sistem digunakan, verifikasi TLS tidak dimatikan.
- Pengujian menggunakan PostgreSQL/database/folder sementara yang terpisah, bukan reset atau restore database aktif.
- Aplikasi dijalankan ulang sebagai proses latar belakang; /api/health, /api/public/config, /admin, /internal dan /eksternal merespons HTTP 200.
- Perbandingan SHA-256 per baris yang dibaca per batch memeriksa sembilan tabel bisnis: submission, submissionValue, customColumn, customRow, customCell, customView, adminNotification, adminNotificationRecipient, emailLog. Hasil sebelum/sesudah sama. Bukti lokal disimpan di data/runtime/audit-business-before.json dan audit-business-after.json; folder data tidak masuk Git/ZIP.

Bukti akhir: test-results/audit-current-final.log; advisori: test-results/audit-current-dependencies.json. Tidak mengirim email nyata atau mengubah status baca notifikasi operasional.

## Batas kesimpulan

Audit ini memverifikasi konfigurasi PostgreSQL lokal dan skenario yang diuji. Pengiriman sungguhan ke Outlook/Gmail/SMTP, konfigurasi hosting produksi, serta banyak pengguna serentak dalam waktu panjang tidak diuji di audit ini. Tidak ada klaim semua database/provider atau setiap kombinasi jaringan dan perangkat sudah bebas bug. Perubahan backend perlu restart; proses lokal sudah dijalankan ulang. Tidak ada migration baru dalam audit ini.
