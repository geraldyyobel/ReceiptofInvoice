# Notifikasi dan pengingat antaradmin

## Pemakaian

1. Login admin dan pilih Internal atau Eksternal.
2. Buka menu **Notifikasi** atau tombol **🔔 Notifikasi** di header. Angka menunjukkan pesan yang belum dibaca pada mode aktif.
3. Klik **Buat notifikasi / pengingat**, isi judul dan pesan, pilih jenis Informasi/Pengingat serta prioritas Biasa/Penting.
4. Pilih satu/beberapa admin, diri sendiri, atau Semua admin aktif. Pilihan semua admin mencakup pengirim dan diperhitungkan saat pesan dibuat; akun baru tidak otomatis ditambahkan ke pesan lama.
5. Untuk muncul nanti, centang **Jadwalkan waktu muncul** dan pilih tanggal/jam. Input mengikuti zona waktu perangkat; waktu disimpan dalam UTC dan ditampilkan mengikuti zona waktu aplikasi. Rentang jadwal maksimum 366 hari.
6. Penerima melihat pesan di **Kotak masuk**, dapat menyaring Belum dibaca dan menandai satu/semua pesan dibaca. Status baca milik setiap admin, tidak mengubah status admin lain.
7. Pengirim memantau pesan dan jumlah pembaca di **Terkirim / terjadwal**, serta dapat membatalkan pesan. Super Admin juga berwenang membatalkan pesan pada mode aktif. Pesan dibatalkan hilang dari kotak masuk; riwayat pengirim tetap tersimpan.

Ini **notifikasi dalam aplikasi**, tanpa email, push sistem Windows, atau suara. Panel memeriksa pembaruan setiap 15 detik saat terlihat. Jika aplikasi/penerima sedang offline, pengingat yang sudah jatuh waktu akan muncul saat aplikasi dibuka kembali. Tidak ada klaim pemberitahuan bisa muncul saat laptop/aplikasi mati. Pesan terpisah menurut mode; pindah mode untuk melihat notifikasi mode lainnya.

## Implementasi dan keamanan

- Tabel `admin_notifications` menyimpan pengirim, judul/isi teks, jenis, prioritas, jadwal dan status pembatalan. `admin_notification_recipients` menyimpan penerima dan waktu baca masing-masing, dengan relasi/cascade serta indeks.
- Semua endpoint berada setelah middleware login dan mode; mutasi tetap memerlukan CSRF. Daftar penerima hanya mengembalikan ID/nama admin aktif, tanpa password atau pengaturan.
- Kotak masuk hanya memuat pesan untuk akun sendiri pada mode aktif, sudah waktunya, dan belum dibatalkan. Pengirim hanya melihat outbox sendiri. Menandai dibaca tidak dapat dilakukan untuk akun lain, mode lain atau pesan masa depan.
- Judul/isi dirender sebagai teks React, bukan HTML. Batas judul 160 karakter, pesan 5.000 karakter; pembuatan dibatasi 20 per menit per akun. Pembuatan pesan dan daftar penerima satu transaksi. Perubahan masuk activity log.
- Pengingat ditentukan dari waktu server pada kueri, sehingga tidak bergantung pada job yang mungkin terlewat ketika aplikasi berhenti. Hasil permintaan lama tidak menimpa badge/list yang lebih baru.
- Backup menyertakan pesan, penerima dan waktu baca. Restore arsip sebelum fitur ini tetap didukung dan mengembalikan tabel notifikasi menjadi kosong. Ekspor/impor provider juga menyertakan tabel baru dan menerima arsip lama.

## Endpoint

Prefix `/api/admin/notifications`:

| Metode/rute | Fungsi |
|---|---|
| GET `/recipients` | ID/nama admin aktif |
| GET `/unread` | `{unread}` untuk akun dan mode aktif |
| GET `?box=inbox\|sent&unread=0\|1&page=1` | Daftar 20 pesan per halaman, total, ukuran, halaman dan penanda box |
| POST `/` | `{title,message,kind:info\|reminder,priority:normal\|urgent,all?:boolean,recipients?:[id],dueAt?:ISO_UTC}` |
| POST `/:id/read` | Tandai dibaca; idempoten |
| POST `/read-all` | Tandai seluruh pesan yang sudah waktunya pada mode aktif |
| POST `/:id/cancel` | Batalkan oleh pengirim/Super Admin; idempoten |

Jika dueAt tidak diberikan, pesan muncul segera. ID akun tidak aktif/tidak ditemukan ditolak, dan duplikasi penerima dihilangkan. Pesan hanya untuk diri sendiri diperbolehkan sebagai pengingat pribadi.

## Memperbarui instalasi lain

Hentikan server, buat backup, jalankan `npm.cmd run db:prepare`, `npm.cmd run db:migrate`, `npm.cmd run build`, lalu jalankan kembali aplikasi. Migration `202611160002_admin_notifications` disertakan untuk PostgreSQL, SQLite dan MySQL; tidak mengubah master/tagihan/tabel kustom yang sudah ada. MySQL belum diuji runtime pada pembaruan ini.

Tes khusus: `npm.cmd run test:postgres -- tests/notifications.test.js`. Tes memeriksa auth/CSRF, penerima tanpa rahasia, mode/akun, status baca idempoten, pengingat masa depan dan catch-up, pembatalan, validasi, UI pembuatan/jadwal/badge, XSS, mobile, backup/restore dan arsip lama. Seluruh pesan pengujian dibuat pada database sementara, bukan dikirim ke akun operasional.


## Verifikasi 16 November 2026

Suite lengkap **82/82 lulus di PostgreSQL** dan **82/82 lulus di SQLite**, termasuk tes browser desktop/mobile dan backup/restore. Build berhasil. Pengujian awal menemukan selector label yang perlu diperjelas serta race tampilan saat berganti inbox/outbox; keduanya diperbaiki dan diuji ulang sampai suite penuh lulus. Log akhir: test-results/notifications-final-postgresql.log dan notifications-final-sqlite.log.

Backup pengaman dibuat sebelum migration pada database aktif. Pemeriksaan pascamigrasi memastikan master/salinan Internal tetap 10.004 dan Eksternal 10.001. Tidak ada pesan percobaan yang dikirim ke admin operasional; tabel notifikasi awal kosong. Bukti pemeriksaan: test-results/notifications-live-check.json. Aplikasi dijalankan kembali di latar belakang pada port 5173, dengan log data/runtime/app-output.log dan app-error.log.


Pembaruan pop-up header: tombol 🔔 membuka dialog lima notifikasi terbaru tanpa berpindah halaman. Dapat menandai satu/semua pesan dibaca dan membuka daftar lengkap. Tutup melalui tombol ×, klik luar dialog, atau Escape; fokus keyboard kembali ke tombol 🔔. Pop-up responsif, memperbarui pesan saat terbuka, dan memakai hak akses mode/penerima yang sama dengan kotak masuk.

Pembaruan Ringkasan, 17 November 2026: panel "Perlu ditinjau" diganti "Notifikasi masuk" yang menampilkan maksimal lima pesan terbaru untuk penerima dan mode aktif, pengirim, waktu, prioritas dan status baca. Tombol "Buka kotak masuk" membuka menu Notifikasi. Panel memeriksa pembaruan setiap 15 detik, saat kembali ke tab, dan saat status baca diubah dari pop-up. Tidak otomatis menandai pesan dibaca. Catatan asumsi tetap tersedia pada Form Builder.
