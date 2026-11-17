# Audit kode dan pengujian — 13 November 2026

Hasil akhir: **57 tes lulus, 0 gagal, 0 dilewati** pada SQLite/Windows, setelah perbaikan di bawah. Build Vite, generate Prisma, dua migration, seed database terisolasi, unit, integrasi, browser desktop/mobile, PDF, mock email, backup dan restore lulus. Audit npm seluruh dependensi (termasuk development) melaporkan **0 kerentanan tercatat**. Audit menggunakan CA sistem yang dipercaya tanpa menonaktifkan pemeriksaan TLS.

## Temuan dan perbaikan

| Temuan | Dampak dan bukti | Perbaikan | Status |
|---|---|---|---|
| Pratinjau template menerima seluruh Settings | Admin biasa yang berhak mengedit template dapat membaca setting di luar metadata dokumen melalui placeholder. Reproduksi memakai setting dummy; password SMTP sebenarnya disimpan terenkripsi, bukan plaintext. | renderHtml membatasi setting ke nama aplikasi/perusahaan, kop, penerima, kode form, zona waktu dan logo. Uji unit menolak sentinel SMTP/OAuth; uji API memakai role Admin biasa. | Diperbaiki, tes lulus |
| Password melebihi 72 byte dipotong bcrypt | Dua string dengan 72 byte awal sama lolos compare meskipun akhiran berbeda. Batas lama menerima 128 karakter. | Buat/ubah akun, login dan seed dibatasi 72 byte UTF-8. Tes ASCII dan karakter multibyte serta penolakan perubahan password yang tidak valid. | Diperbaiki, tes lulus |
| Tanggal mustahil di tabel kustom | Pemeriksaan lama hanya melihat bentuk YYYY-MM-DD, sehingga 30 Februari dapat masuk. | Memeriksa tanggal kalender nyata; 29 Februari hanya diterima pada tahun kabisat. Penolakan tidak menyimpan sel. | Diperbaiki, tes lulus |
| Pagination pecahan masuk ke Prisma | page/size pecahan dapat memicu respons error server. | Dibulatkan ke bilangan bulat dan tetap dibatasi. Uji tabel kustom, backup dan master. | Diperbaiki, tes lulus |
| Folder upload belum dipulihkan pada kegagalan rename kedua saat restore | Alur lama memindahkan folder asli sebelum memasang staging; kegagalan pemasangan bisa membuat folder aktif tidak tersedia. | swapUploadFolders mengembalikan folder asli bila pemasangan gagal. Simulasi folder terkunci memverifikasi rollback; restore end-to-end tetap lulus. Jika filesystem juga menolak rollback, error menyebut perlunya pemulihan oleh pengelola; folder asli tidak dihapus. | Diperbaiki, tes lulus |

Kode terkait: [core.js](server/core.js), [app.js](server/app.js), [custom-editing.js](server/custom-editing.js), [upload-swap.js](server/upload-swap.js), [backup.js](server/backup.js), [seed.js](prisma/seed.js).

## Pemeriksaan keamanan yang dilakukan

- Penolakan akses admin tanpa login; role Admin/Super Admin; pemisahan mode data dan backup; master tidak dapat diedit lewat UI/API.
- CSRF, Origin asing, cookie httpOnly, penutupan session setelah perubahan akun/restore.
- Sanitasi HTML, escape placeholder, daftar setting dokumen; tidak ditemukan pemakaian raw SQL tidak aman/eval pada jalur yang ditinjau.
- Upload bertipe/signature terlarang, file privat tidak dapat dibaca publik atau mode lain.
- Token dokumen untuk client publik, HTML/PDF, OAuth state sekali pakai, PKCE, callback setelah logout, refresh/revokasi, token terenkripsi dan redaksi log (provider dimock).
- Transaksi submit dan nomor unik serentak; sinkron kustom hanya menambah; konflik Undo/Redo tidak menimpa perubahan admin lain.
- Snapshot backup tetap setelah data aktif berubah, ekspor mode saja, warna/kolom tersembunyi, arsip terenkripsi, restore dua langkah dan pemulihan folder ketika gagal.

## Hasil PDF dan tes koneksi

Pada dua percobaan awal, pembaca respons biner Superagent mengalami ECONNRESET/double callback. Pengujian unduh sekarang memakai Fetch seperti frontend dan tetap menguji endpoint HTTP sebenarnya, token, status 200, content-type PDF dan signature byte PDF. Run integrasi terpisah (28/28) dan run akhir penuh (57/57) berhasil. Tidak ada retry otomatis yang menyembunyikan kegagalan. Hasil ini mengarah ke jalur pembacaan koneksi alat tes; akar masalah internal Superagent belum dibuktikan secara menyeluruh.

## Instalasi lokal dan dampak perubahan

Aplikasi dinyalakan kembali di port 5173. Health, beranda, Internal dan Eksternal HTTP 200. Settings, backup tabel dan master tanpa login HTTP 401. Konfigurasi publik tidak memuat setting rahasia. Tes submit/restore memakai database dan direktori upload terpisah; tidak ada email nyata yang dikirim. Tidak ada migration baru, reset password otomatis, atau penghapusan data operasional.

Akun lama dengan password lebih dari 72 byte UTF-8 perlu password baru melalui Super Admin/pengelola server; password dalam batas tersebut tetap memakai hash yang ada. Batas ini juga dijelaskan di pengelolaan akun dan README.

## Batas kesimpulan

Ini tinjauan kode dan pengujian aplikasi lokal, bukan jaminan bebas seluruh bug atau audit penetrasi independen. Pengiriman SMTP nyata, login/pengiriman OAuth provider nyata, deployment HTTPS/reverse proxy, PostgreSQL/MySQL, build Docker, serta uji beban besar tidak diuji ulang pada sesi ini. Operasi backup masih mengikuti rancangan satu instance aplikasi. Hasil audit dependensi hanya mencakup advisori yang diketahui registry saat pemeriksaan.
