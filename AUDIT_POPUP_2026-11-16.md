# Audit pop-up dan aplikasi — 16 November 2026

**Dua bug terkonfirmasi dan sudah diperbaiki.** Suite penuh PostgreSQL berhasil **82/82**, build berhasil, audit npm mencatat **0 advisori**, dan aplikasi aktif merespons normal.

| Prioritas | Temuan dan bukti | Perbaikan |
|---|---|---|
| P1 | Jika fokus keyboard jatuh ke body ketika pop-up terbuka, Ctrl+Z masih bisa mengirim Undo ke Tabel Kustom di belakangnya. Reproduksi browser membuktikan satu permintaan `/custom/undo` terkirim, padahal harus nol. | Handler Undo/Redo menolak pintasan ketika ada dialog yang terlihat. Fokus Tab dari luar pop-up juga dikembalikan ke kontrol pop-up. Tes memastikan tidak ada permintaan Undo dan nilai sel tetap sama; setelah dialog ditutup, Undo normal tetap berfungsi. |
| P2 | Membaca notifikasi lewat pop-up sudah memperbarui database dan badge, tetapi daftar utama tetap menunjukkan Belum dibaca sampai polling berikutnya, hingga 15 detik. | Daftar utama kini mendengarkan peristiwa perubahan yang sama dengan badge dan langsung memuat ulang. Jalur pembaruan sendiri juga memakai peristiwa tersebut agar tidak membuat permintaan ganda. |

Kode terkait: `client/src/custom.jsx` dan `client/src/notifications.jsx`. Tidak ada perubahan backend, skema database, atau migration pada audit ini. Status baca percobaan dan pengujian Undo memakai database sementara, bukan data operasional.

## Bukti pengujian

- Suite awal PostgreSQL: 82/82 lulus. Dua kasus tambahan kemudian berhasil mereproduksi bug yang tidak tercakup sebelumnya.
- `popup-audit-reproduction.log`: uji status daftar setelah baca dari pop-up gagal sebelum perbaikan.
- `popup-keyboard-reproduction.log`: uji browser gagal karena Ctrl+Z mengirim Undo ke belakang dialog.
- `popup-audit-fixed.log`: tes notifikasi 8/8 lulus setelah sinkronisasi diperbaiki.
- `popup-audit-final.log`: suite penuh 82/82 lulus setelah perbaikan, tanpa kegagalan/dibatalkan/dilewati, sekitar 89,3 detik.
- `popup-audit-target-final.log`: 9/9 pemeriksaan terarah akhir browser dan notifikasi lulus, mencakup penyempurnaan fokus serta penjagaan dialog yang terlihat.
- `popup-audit-dependencies.json`: audit seluruh dependensi produksi/development, 0 advisori tercatat. Verifikasi TLS tetap aktif dengan CA sistem.

Log dan JSON berada di `test-results`. SQLite tidak diuji ulang pada audit ini; pengujian terbaru memakai PostgreSQL aktif proyek dengan database tes terpisah.

## Pemeriksaan aplikasi yang sedang berjalan

Pada Internal dan Eksternal, pop-up berhasil dibuka tanpa berpindah halaman, menampilkan maksimal lima pesan, dapat ditutup melalui Escape dan klik luar, serta mengembalikan fokus ke tombol header. Fokus keyboard tetap di dialog saat menekan Shift+Tab. Lebar pop-up sesuai viewport HP 390 px. Tidak ada error JavaScript teramati pada pemeriksaan tersebut. Health HTTP 200; log error aplikasi saat diperiksa kosong.

Master/salinan yang teramati tetap 10.004 Internal dan 10.001 Eksternal. Pemeriksaan aplikasi aktif hanya membuka pop-up; tidak menandai pesan nyata dibaca, membatalkan pesan, atau mengubah tabel. Judul/isi pesan operasional tidak disalin ke laporan. Bukti: `test-results/popup-audit-live.json`.

Suite regresi lain mencakup login/CSRF/role, mode, percabangan, tanggal, PDF, email mock, nomor buku tahunan, pagination, ekspor, sinkronisasi, Undo/Redo, backup/restore serta browser. Kelulusan ini tidak merupakan jaminan seluruh bug tidak ada. Email/OAuth akun nyata, Docker, MySQL, uji penetrasi dan banyak pengguna bersamaan tidak diuji pada audit ini.
