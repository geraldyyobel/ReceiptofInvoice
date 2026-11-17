# Hasil pengujian 12 November 2026

**Hasil: 51 tes lulus, 0 gagal, 0 dilewati.** Perintah: npm.cmd test, termasuk generate Prisma, migration/seed database terisolasi, build Vite, unit, integrasi dan browser. Data operasional tidak dipakai untuk submit/restore pengujian. Tidak ada email eksternal dikirim.

| Area | Hasil |
|---|---|
| Instalasi skema dan build | Generate Prisma, dua migration, seed, build lulus |
| Form publik | Percabangan, nilai tersembunyi, validasi, total, nomor referensi serentak lulus |
| Tanggal | Batas 6 bulan, akhir bulan/tahun kabisat, zona waktu, batas inklusif, penolakan server lulus |
| Admin dan keamanan | CSRF, session, role, isolasi mode, XSS, upload, master read-only lulus |
| Ketentuan/form/template | Versioning, publish/rollback, ON/OFF, CRUD dan placeholder historis lulus |
| Tabel kustom | Tambah otomatis tanpa menimpa edit, warna/XLSX, Undo/Redo, konflik, batas 50 dan reset lulus |
| PDF | Unduh PDF asli dan HTML, escaping, perbedaan template kedua mode lulus; ECONNRESET pada pemeriksaan sebelumnya tidak muncul pada run ini |
| Email | SMTP dan OAuth memakai mock: lampiran, status/log, PKCE/state, callback, refresh/revokasi lulus |
| Backup | Slot 00:00/12:00, restart/retry, backup manual, enkripsi dan restore dua langkah lulus |
| Browser desktop/mobile | Alur vendor sampai unduh, admin, editor, navigasi, Undo/Redo dan tautan mode lulus |
| Audit dependensi produksi | npm audit --omit=dev: 0 kerentanan; CA sistem dipakai tanpa menonaktifkan TLS |
| Aplikasi lokal | Dinyalakan di port 5173; health, beranda, admin dan kedua tautan form HTTP 200; endpoint admin tanpa login HTTP 401 |

## Batas hasil
Pengiriman SMTP nyata belum diuji. Kredensial Google/Microsoft belum diisi sehingga login/pengiriman OAuth nyata belum dapat diverifikasi. PostgreSQL/MySQL dan build Docker tidak diuji ulang pada sesi ini. Backup pada jam sebenarnya memerlukan aplikasi tetap menyala; perilaku scheduler diuji otomatis. Kelulusan tes bukan jaminan semua kemungkinan penggunaan bebas masalah.

Pembaruan pilihan backup tabel dan penghapusan pertanyaan tersembunyi, 12 November 2026: seluruh **53 tes lulus** setelah generate Prisma, migration/seed terisolasi dan build. Tes API memastikan snapshot tidak berubah setelah tabel aktif diedit; Admin biasa hanya dapat membaca mode session aktif; arsip lengkap tetap ditolak untuk Admin biasa. Unduhan JSON/CSV/XLSX, warna XLSX, kolom tersembunyi, view, format salah dan ID tidak ditemukan diuji. Uji browser mencakup memilih backup, membaca pratinjau, mengunduh JSON, dan ukuran modal mobile; screenshot custom-backups.png/custom-backups-mobile.png diperiksa secara visual.

Script lokal membuat backup pengaman sebelum menghapus paham_ketentuan dari form aktif Internal. Form publik Internal HTTP 200 dengan Email anda sebagai pertanyaan pertama; Eksternal HTTP 200 tetap memuat paham_ketentuan. Tes membuktikan versi/jawaban historis tetap utuh, draft versi lama ditolak, section valid, script idempoten dan checkbox ketentuan ON tetap wajib. Arsip lama lokal berhasil dibaca sebagai snapshot kustom. Health 200; jadwal tetap 00:00 dan 12:00 Asia/Jakarta. Tidak ada migrasi skema baru.
