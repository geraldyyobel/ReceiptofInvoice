# Receipt of Invoice — PT Bumi Cahaya Unggul 2026

Aplikasi React + Vite, Express REST API dan Prisma. Bahasa antarmuka Indonesia. Mode `internal` dan `eksternal` memiliki form, ketentuan, template, jawaban, tabel kerja dan tema tersendiri. Settings, akun dan backup bersifat global.

Lihat [referensi REST API](API.md), [hasil verifikasi](VERIFIKASI.md), dan contoh dokumen di `examples/`. Paket ZIP tidak berisi `.env`, database, rahasia, atau node_modules; setup membuat rahasia baru.

## Mulai di komputer lokal

Prasyarat: Node.js 24 LTS (atau 22.12+), npm, PostgreSQL 17 (lokal Windows atau server tersendiri), dan ruang untuk Chromium Playwright. Konfigurasi aktif sekarang memakai PostgreSQL. Panduan: [POSTGRESQL.md](POSTGRESQL.md).

```sh
npm ci
npm run setup
npm run browser:install
npm run dev
```

Buka <http://localhost:5173> untuk vendor dan <http://localhost:5173/admin> untuk admin. Mode dev memakai API di port 3000 (API_PORT). npm start menjalankan hasil build di port 5173 dan memastikan PostgreSQL lokal khusus proyek aktif. Setup membuat konfigurasi dan rahasia awal, menyiapkan PostgreSQL lokal jika LOCAL_POSTGRES_DIR diisi, lalu menjalankan migrasi dan seed. Kunci aplikasi dan password akun yang sudah ada dipertahankan; bootstrap lokal menyelaraskan koneksi database. Boleh pula menyalin `.env.example` dan mengisi nilainya sendiri.

**Akun awal:** `admin@bcupt.id`, role **Super Admin**. Password acak ada pada `ADMIN_PASSWORD` di `.env`; tidak ada password universal. Setelah login, ubah password melalui Settings → Akun admin. Mengubah password menutup seluruh session akun tersebut. `ADMIN_PASSWORD` hanya untuk pembuatan akun pertama, bukan untuk reset.

Di jaringan yang menggunakan sertifikat perusahaan, gunakan sertifikat CA sistem yang dipercaya: PowerShell `$env:NODE_USE_SYSTEM_CA='1'` atau `NODE_EXTRA_CA_CERTS` yang menunjuk CA perusahaan. Jangan menonaktifkan validasi TLS.

```sh
npm run build
# port lokal default 5173; APP_ORIGIN harus sesuai alamat yang dibuka
npm start
```

## Arsitektur dan folder

```text
client/src/       React: alur vendor, admin, builder, tabel kustom, editor
shared/engine.js  Mesin jalur/validasi yang digunakan klien dan server
server/app.js    REST API, otorisasi per mode, ekspor, CRUD admin
server/core.js   Prisma, sanitasi, enkripsi, format referensi, audit
server/documents.js  HTML, PDF Chromium, SMTP
server/backup.js Dump transaksional + upload, kompresi/enkripsi, restore
server/custom-history.js Jurnal Undo/Redo per admin/mode dan pemeriksaan konflik
server/custom-editing.js Perubahan tabel kustom dalam transaksi dan aksi berkelompok
server/index.js  Server dan scheduler backup dua kali sehari
prisma/schema.prisma     Sumber skema provider-netral
prisma/migrations-*/     Migrasi awal SQLite, PostgreSQL, MySQL
prisma/initial.js        Seed lengkap: ketentuan, form, template, settings
scripts/         Setup, pemilihan provider, container, pengujian
tests/           Unit, integrasi API dan browser
data/            Instance PostgreSQL lokal, upload, backup dan SQLite lama (tidak publik)
```

Relasi logis menggunakan ID dan snapshot versi. Skema sengaja tidak memakai foreign key berantai agar dump lintas provider dapat direstore transaksional. API memvalidasi kepemilikan/keberadaan ID dan mode. Semua tabel mode mempunyai `mode`; tabel `modes` memakai `id` sebagai kode mode.

| Kelompok      | Tabel                                                                                          |
| ------------- | ---------------------------------------------------------------------------------------------- |
| Identitas     | admins, sessions, modes                                                                        |
| Konten        | terms, terms_versions, forms, form_versions, form_fields, doc_templates, doc_template_versions |
| Master        | submissions, submission_values, reference_counters                                             |
| Salinan kerja | custom_columns, custom_rows, custom_cells, custom_views                                        |
| Operasional   | uploads, activity_logs, email_logs, backups, settings                                          |

Master append-only melalui API/UI: tidak ada endpoint ubah/hapus submission. Submission menyimpan versi form, ketentuan yang disetujui, versi template dan snapshot pengaturan dokumen. Perubahan template/penerima tidak mengubah hasil cetak historis. Penyuntingan tabel kustom tidak menyentuh tabel master. Status master awal `diterima`; status pengiriman email berada di Email Log.

## Pergantian database

Prisma tidak dapat mengganti connector hanya dengan URL pada client yang sudah digenerate. Aplikasi memilih connector dari `DATABASE_PROVIDER`, menyiapkan skema ke `prisma/generated`, lalu memakai direktori migrasi yang sesuai. Setelah mengubah environment, jalankan:

```sh
npm run db:prepare
npm run db:migrate
npm run db:seed
```

| Provider     | Environment                                                                                           |
| ------------ | ----------------------------------------------------------------------------------------------------- |
| SQLite lokal | `DATABASE_PROVIDER=sqlite`, `DATABASE_URL=file:../../data/roi.db`                                     |
| PostgreSQL   | `DATABASE_PROVIDER=postgresql`, `DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/roi?schema=public` |
| MySQL 8+     | `DATABASE_PROVIDER=mysql`, `DATABASE_URL=mysql://USER:PASSWORD@HOST:3306/roi`                         |

URL SQLite relatif terhadap `prisma/generated/schema.prisma`, bukan terminal. PostgreSQL/MySQL perlu database kosong yang sudah dibuat dan hak migrasi. Berpindah provider tidak memindahkan data otomatis. Backup logis dapat dipulihkan menggunakan kunci enkripsi yang sama dan versi aplikasi/skema yang sama. Pengujian paket ini telah dijalankan pada SQLite, PostgreSQL 17, dan MySQL 8.4. Tetap verifikasi konfigurasi jaringan, TLS, SMTP, dan kapasitas pada server tujuan sebelum peluncuran.

Perubahan skema berikutnya harus memiliki migrasi baru untuk setiap provider; jangan menjalankan `migration:create` pada database produksi karena helper tersebut hanya membangun **baseline awal dari kosong**, bukan migrasi peningkatan.

## Fitur vendor

1. Pilih mode, baca HTML ketentuan terpublikasi, centang persetujuan.
2. Isi pertanyaan dengan validasi, progress bar dan draft browser per mode. Draft kedaluwarsa setelah 30 hari atau ketika versi form berubah. Hapus draft tersedia.
3. Jalur berjalan mengikuti opsi, kondisi dan lompatan. Kembali menelusuri pertanyaan yang masih berada di jalur tersebut.
4. Review jawaban, kirim, terima nomor atomik per mode/tahun. Total dihitung server dalam satuan sen.
5. Unduh PDF A4 atau HTML siap cetak. Kirim PDF melalui SMTP dengan alamat awal dari `email_anda`.

Token dokumen acak diberikan hanya saat submit dan disimpan pada sessionStorage tab tersebut. Kirim token sebagai header `X-Document-Token`, bukan URL. Simpan dokumen sebelum menutup tab; admin dapat mengunduh/kirim ulang jika akses vendor hilang. Persetujuan ketentuan, versi form dan tahun penomoran divalidasi server.

Jika browser menolak penyimpanan akses/draft, invoice yang sudah berhasil disimpan server tetap menampilkan halaman sukses dan dapat diunduh. Peringatan meminta pengguna menyimpan dokumen/nomor referensi sebelum menutup halaman. Kegagalan penyimpanan browser tidak mengubahnya menjadi gagal submit.

Pemeriksaan terbaru: [AUDIT_ULANG_2026-11-16.md](AUDIT_ULANG_2026-11-16.md). **82 tes lulus** pada PostgreSQL dan SQLite setelah penambahan notifikasi admin. Penyimpanan form/template bersamaan kini menolak versi yang sudah berubah; angka kustom dinormalisasi dan sorting desimal/scientific diperbaiki. Pencarian browser pada 10.000 baris per mode tetap sekitar 1 detik. Rincian pembukuan: [PERBAIKAN_TABEL_TAHUNAN_2026-11-16.md](PERBAIKAN_TABEL_TAHUNAN_2026-11-16.md).

## Tujuh menu admin

1. **Data Form:** pencarian/filter tanggal/vendor/status, urutan, halaman, detail historis, CSV/XLSX, unduh ulang, kirim ulang. Waktu mulai/selesai adalah metadata.
2. **Tabel Kustom:** setiap submission otomatis disalin sebagai baris baru dalam transaksi yang sama dengan master. Sel, warna, baris manual, susunan/label/visibilitas kolom, dan view yang sudah disesuaikan tidak ditimpa. Halaman mengecek baris baru setiap 15 detik saat tidak mengedit. Kolom yang dihapus tidak dibuat ulang; jawaban lengkap tetap di Data Form. Tombol **Sinkronisasi ulang** berada di bagian tertutup **Tindakan lanjutan** di bawah tabel dan memerlukan ketikan `SINKRONISASI ULANG`. Aksi ini hanya menambah baris yang belum tersalin (termasuk salinan yang pernah dihapus), bukan mengembalikan nilai master ke sel yang sudah diedit. **Undo/Redo:** tombol di toolbar, Ctrl+Z untuk membatalkan, Ctrl+Y/Ctrl+Shift+Z untuk mengulangi. Menyimpan maksimal 50 perubahan baru per akun admin dan mode, tetap tersedia setelah refresh/login ulang. Mendukung isi/warna sel, warna baris, tambah/hapus baris atau kolom beserta isinya, pengaturan/urutan/visibilitas kolom, dan simpan/hapus view. Satu geseran urutan atau penerapan visibilitas view adalah satu langkah; pencarian/pengurutan tampilan lokal tidak masuk jurnal. Form masuk otomatis tidak masuk jurnal dan tidak membuang Redo. Perubahan manual baru mengosongkan Redo; menyimpan nilai yang sama tidak membuat langkah. Fitur lain: edit sel, tambah/hapus baris/kolom, nama/tipe/opsi kolom, urutan seret, visibilitas, beberapa view pencarian/urutan, warna sel/baris/kolom, reset dengan frasa. Prioritas warna: sel → baris → kolom. Ekspor XLSX mempertahankan warna. **CSV tidak bisa menyimpan warna** karena keterbatasan format. Ekspor mencakup semua baris dan kolom yang tidak disembunyikan; pencarian view membantu tampilan UI. Browser mengambil 50 baris per halaman; pencarian dan pengurutan seluruh hasil dilakukan server. Polling mengambil halaman aktif dan menghormati isian yang sedang diedit. Ekspor CSV/XLSX mengambil seluruh hasil filter tahun/pencarian secara bertahap, 500 baris per batch, dengan indeks sel Map; warna XLSX tetap dipertahankan.

   Riwayat dimulai sejak fitur Undo/Redo dipasang; perubahan sebelumnya tidak dapat dibatalkan. Server membandingkan nilai yang akan dibatalkan dengan data terkini dan menolak konflik (409), termasuk perubahan tab/admin lain, baris yang disalin ulang, atau dependensi yang telah dihapus. Nilai lain yang tidak terkait dan baris otomatis tetap dipertahankan. Riwayat bersifat pribadi per admin, sedangkan tabel tetap dibagi bersama admin lain dalam mode itu. Di dalam kotak isian, pintasan tetap memakai Undo teks bawaan browser; tombol toolbar bekerja pada perubahan yang sudah tersimpan.

   **Reset salinan dan Restore menghapus seluruh riwayat Undo/Redo yang terkait. Reset dan Sinkronisasi ulang tidak termasuk aksi yang dapat di-undo.** Reset mengosongkan riwayat semua admin pada mode aktif; Restore mengosongkan semua mode. Jurnal `custom_history` tidak disertakan dalam isi arsip backup agar tidak diputar ulang pada data hasil restore. Migration `202611030001_custom_history` tersedia untuk SQLite/PostgreSQL/MySQL; jalankan `npm run db:prepare` lalu `npm run db:migrate` saat server berhenti untuk memperbarui instalasi lama.

3. **Ketentuan:** TinyMCE npm self-hosted, warna teks/latar, font/ukuran, numbering/bullet, inden, heading, alignment/line height, gambar unggah/paste/drag, ukuran gambar, tabel/tautan/garis. Draft autosave, simpan versi, Publish, preview dan rollback ke draft. Dua placeholder sumber tetap terlihat.
4. **Form Builder:** CRUD dan urutan field, section, delapan tipe, opsi/impor teks, default, bantuan, min/max/regex, status aktif, UI kondisi/aksi, preview dan peta alur. Setiap simpan membuat versi aktif baru. Versi lama dapat dimuat lalu disimpan sebagai versi baru. Penghapusan field yang mempunyai jawaban historis ditolak; nonaktifkan field tersebut. Kode field merupakan identitas historis.
5. **Template:** editor HTML, preview sandbox tanpa skrip, contoh data JSON, versi, daftar placeholder, unduh contoh PDF/HTML. Hanya `{{kode}}`, `{{setting.kode}}`, `{{format_number x}}` dan `{{format_date x 'dd-MM-yyyy'}}` yang diterima; nilai otomatis di-escape. Tidak ada evaluasi kode Power Automate atau Handlebars bebas.
6. **Log/backup:** pencarian/filter/ekspor Activity/Email Log. Aksi konten, admin, login gagal/berhasil, unduh, ekspor, perubahan salinan dan email dicatat dengan IP serta sebelum/sesudah. Rahasia tidak masuk log. Backup/unduh/restore khusus Super Admin karena mencakup semua akun dan mode.
7. **Settings:** umum/dokumen, logo, zona waktu, format nomor, tema utama/aksen, SMTP dan tes kirim, kebijakan password/session/rate limit/upload, jadwal/retensi/lokasi backup, akun dan role. Password SMTP dienkripsi AES-256-GCM. Password kosong mempertahankan SMTP lama. Konfigurasi SMTP melalui environment menjadi fallback bila host Settings kosong.

Form builder mendukung grup kondisi **AND/OR bertingkat** (maksimal 5 tingkat dan 50 kondisi per pertanyaan), operator eq/neq/contains/empty/filled. Percabangan per opsi tersedia untuk pilihan tunggal; multi pilihan menggunakan aturan tampil. Lompatan hanya maju, boleh ke field atau section (field pertama section), sehingga loop tidak mungkin. Nilai semua pertanyaan yang dilewati/nonaktif/tersembunyi dibersihkan pada klien dan dihitung ulang pada server. Aksi akhir biasa memotong jalur, menampilkan pesan, lalu mengizinkan review dan submit jawaban yang sudah dilalui. Opsi "Hentikan tanpa submit dan kembali ke ketentuan" memblokir submission; seed paham_ketentuan=Belum memakai opsi ini. Section menjadi kelompok dan target lompatan; vendor mengisi satu pertanyaan per langkah.

## Asumsi yang WAJIB dikonfirmasi sebelum operasional

- **Template Eksternal dan Internal sudah diperbarui berdasarkan HTML yang diberikan pengguna pada 2 November 2026.** CSS dan susunan bagian dipertahankan; ekspresi Power Automate diganti placeholder aplikasi, tahun dinamis, penerima/kode form dari Settings. Sumber seed: `prisma/document-templates.js`. Database lama dapat diperbarui dengan `node scripts/update-document-templates.js`; template lama tetap tersimpan dalam riwayat dan dipakai submission historis. Contoh cetak: `examples/roi-eksternal.pdf` dan `examples/roi-internal.pdf`.
- **Form Internal dan ketentuan Internal disalin dari Eksternal** dan ditandai perlu ditinjau. Admin dapat mengubah tanpa coding.
- **Kondisi VAT/NSFP (#10–11), NITKU/email bukpot (#13–14), opsi dropdown #1, #9, #12, #26 dan #28 adalah asumsi berdasarkan nama kolom.** Tercantum pada ringkasan dan builder, seluruhnya dapat diubah tanpa coding.
- Daftar currency awal IDR/USD/EUR/SGD/JPY/AUD/GBP/CNY; admin mengatur lebih lanjut.
- `[ADMIN MENGISI DATA NPWP BCU DI EDITOR]` dan `[ADMIN MELENGKAPI CONTOH/TABEL]` dipertahankan, tidak diisi dengan data rekaan.
- Kelompok subvendor 1–4 menghasilkan dua field nama/kontak per vendor; nomor urut sumber yang tumpang tindih bukan identitas field. Kode field adalah acuan.
- Ketentuan legal/faktur pajak 2026 disalin dari permintaan sebagai konten awal, bukan hasil verifikasi peraturan terbaru. Admin BCU bertanggung jawab meninjau konten dan penerbitannya.

## Keamanan dan operasi

Session acak disimpan ter-hash HMAC di database; cookie httpOnly, SameSite Strict, Secure pada production. Login memakai bcrypt 12 putaran dan pembatasan per IP. Semua mutasi termasuk login membutuhkan token CSRF dari `/api/csrf`, cookie bertanda tangan, dan header `X-CSRF-Token`; Origin dibatasi `APP_ORIGIN` (pisahkan dengan koma bila perlu). CORS bukan kontrol akses tunggal. Setiap endpoint admin memeriksa session, role dan mode server. Password minimal 12 karakter dengan huruf besar, kecil dan angka untuk akun yang dikelola melalui UI.

Di `/admin`, pilih **Password** atau **OTP email BCU**. Login password memerlukan akun aktif yang sudah terdaftar. Email `@bcupt.id` baru otomatis terdaftar sebagai **User** setelah verifikasi OTP berhasil. Akun nonaktif tetap diblokir. OTP memakai **Settings → Email / SMTP**. Kode berlaku lima menit, hanya bisa dipakai sekali pada browser peminta, maksimal lima tebakan, dan permintaan ulang dibatasi satu kali per menit per email. Kode gugur ketika aplikasi dimulai ulang atau backup dipulihkan.

SMTP memverifikasi sertifikat server menggunakan CA bawaan Node.js serta CA tepercaya sistem operasi (Node.js 22.15+ atau 24+). Ini mendukung CA perusahaan yang sudah dipasang di Windows. Jika muncul `unable to verify the first certificate`, periksa rantai sertifikat server SMTP dan CA perusahaan di mesin aplikasi. Di Docker, CA harus dipasang di container. Sertifikat tambahan juga bisa diberikan melalui `NODE_EXTRA_CA_CERTS` saat menjalankan Node.js. Mulai ulang aplikasi setelah mengubah CA. Verifikasi sertifikat SMTP tetap aktif.

Sanitasi allowlist server untuk ketentuan/template; placeholder selalu di-escape; JS/remote CSS/URL CSS tidak diizinkan. PDF menggunakan konteks Chromium tanpa JavaScript dan tanpa akses jaringan. Hanya gambar unggahan lokal yang divalidasi di-embed. Unggahan diperiksa signature MIME, ukuran dan nama acak, tanpa SVG/HTML. File vendor privat hanya dapat diunduh admin mode yang sama; gambar editor sengaja publik. File opsional vendor menyimpan ID+token unggahan pada nilai jawaban. Hindari unggah informasi rahasia ke editor ketentuan karena itu konten publik.

`SESSION_SECRET` dan `ENCRYPTION_KEY` wajib diisi; tidak ada fallback rahasia bawaan. Simpan kunci di secret manager dan backup terpisah. Mengubah SESSION_SECRET membatalkan session/token unduh lama. Mengganti ENCRYPTION_KEY memerlukan prosedur rotasi data SMTP dan arsip; jangan menggantinya tanpa menyimpan kunci lama.

Activity Log mengandung snapshot jawaban/isi yang berubah dan harus diperlakukan sebagai data privat. Tidak ada endpoint hapus log/master. Penjaga jaringan/proxy production harus membatasi ukuran request dan mengaktifkan TLS.

## Backup dan restore

Backup otomatis dijadwalkan **00:00 (tengah malam)** dan **12:00 (siang)**, default zona waktu **Asia/Jakarta (WIB)** dan retensi 30 hari. Kedua jam dapat diatur di Settings → Backup melalui `backup_jam` dan `backup_jam_kedua`. Satu instance aplikasi mengecek jadwal setiap menit. Penanda slot sukses tersimpan di database, sehingga backup siang tidak membatalkan jadwal malam dan restart tidak menggandakan slot yang sudah selesai. Backup manual tidak mengganti penanda jadwal.

Aplikasi harus berjalan agar backup tepat waktu. Saat mulai kembali setelah mati, scheduler membuat satu backup untuk slot terakhir yang terlewat, tanpa mengarang snapshot untuk jam-jam lama. Kegagalan dicoba lagi pada pengecekan berikutnya. Jangan menjalankan beberapa instance scheduler pada database/volume yang sama; mutex pemeliharaan berada dalam satu proses.

Untuk memperbarui instalasi lama setelah menghentikan server, jalankan `node scripts/configure-custom-automation.js` sekali. Script membuat backup pengaman, menambahkan salinan baris master yang belum ada tanpa menimpa edit, memeriksa seluruh data kustom lama tetap identik, lalu mengatur jadwal menjadi 00:00 dan 12:00. Tidak ada perubahan skema database. Seed baru sudah memakai jadwal ini.

Backup `backup_YYYY-MM-DD_HHmm_timestamp.zip.enc` berisi dump logis database konsisten dan seluruh upload yang terdaftar. Ini dump Prisma, bukan `pg_dump`/`mysqldump`; tersedia lintas provider. Kompresi ZIP lalu AES-256-GCM. Data session tidak dibackup. Arsip bukan file ZIP yang dapat dibuka langsung tanpa kunci.

Lokasi hanya dapat berupa subfolder `DATA_DIR` di luar uploads, tidak dilayani static. Backup/restore menolak permintaan baru dan menunggu permintaan API aktif selesai, agar unggahan/snapshot konsisten. Restore langkah 1 memilih arsip, langkah 2 meminta frasa+token sekali pakai 2 menit. Backup pengaman dibuat sebelum penggantian; database direstore dalam transaksi dan folder upload diganti melalui staging. Kegagalan transaksi mengembalikan folder upload lama. Seluruh session diakhiri setelah restore. Riwayat arsip tetap tersedia terpisah dari isi dump.

Retensi dijalankan sesudah backup terjadwal sukses. Simpan salinan arsip dan kunci di media lain; volume lokal saja tidak melindungi dari kerusakan mesin. Saat crash keras di tengah penggantian folder restore, hentikan proses, periksa folder `uploads-before-*` di DATA_DIR dan pulihkan dengan arsip pengaman. Jangan melayani trafik selama pemulihan.

## Docker / produksi

```sh
# buat .env terlebih dulu, kemudian atur NODE_ENV=production
# APP_ORIGIN=https://roi.domain-anda.id dan rahasia/SMTP/database produksi
docker compose up --build -d
```

Container menjalankan generate client, deploy migration, seed idempoten, lalu server. PostgreSQL 17 memakai volume `roi_pg_data`; upload/backup aplikasi memakai `roi_data`. Port web default localhost:5173 dan database Docker localhost:5544, dapat diatur lewat WEB_PORT/PG_DOCKER_PORT. Ini database terpisah dari instance Windows. Letakkan reverse proxy HTTPS di depannya karena cookie Secure membutuhkan HTTPS. `TRUST_PROXY=1` hanya bila tepat satu proxy tepercaya yang menghapus/mengganti X-Forwarded-For; default 0. Gunakan **satu instance aplikasi** untuk mutex backup serta rate limit proses. Multi replica membutuhkan antrean/mutex terdistribusi dan rate limit bersama sebelum digunakan.

Dockerfile berjalan sebagai user `node`, memasang dependensi Chromium Linux. Compose menghubungkan aplikasi ke layanan PostgreSQL dan membuat role aplikasi non-superuser. Isi POSTGRES_PASSWORD dan POSTGRES_ADMIN_PASSWORD pada konfigurasi privat. Jangan memasukkan `.env`, data, atau password ke image. Backup di volume yang sama tetap perlu disalin ke luar mesin. Konfigurasi Compose baru sudah divalidasi; build/runtime Docker belum diuji ulang pada pembaruan PostgreSQL ini.

TinyMCE self-hosted memakai `TINY_LICENSE_KEY=gpl` untuk penggunaan yang sesuai lisensi GPL TinyMCE. Jika distribusi Anda memerlukan lisensi komersial, masukkan kunci TinyMCE yang sesuai dan tinjau ketentuan distribusi dependensi. Paket ini tidak memakai fitur premium/editor cloud. Paket bahasa Indonesia lengkap `tinymce-i18n/langs8/id.js` dilayani dari server sendiri.

## Tes

```sh
npm test
```

Perintah membuat database/direktori uji terisolasi dengan rahasia acak, menyiapkan skema SQLite, menjalankan seed dan build, kemudian unit test, integrasi HTTP dan browser Chromium desktop/mobile. Setelah selesai client dikembalikan ke provider runtime. Untuk pengujian database aktif PostgreSQL, gunakan npm.cmd run test:postgres; sesi migrasi ini lulus seluruh 57 tes pada PostgreSQL. Data operasional tidak dihapus/disentuh. Browser harus dipasang lebih dulu. Pada Windows, hentikan server/dev sebelum generate Prisma karena library database tidak dapat diganti saat dipakai proses lain.

Mencakup jalur subvendor 0–4, kondisi dan pembersihan field, validasi tanggal/email/angka, lompatan section/loop, total sen, CSRF, session/role/mode, submit dan nomor unik, master read-only, sinkron salinan dan warna XLSX, CRUD/versioning form, ketentuan/template, XSS, PDF asli, email sukses/gagal dengan transport mock, signature upload, backup/restore dua langkah, serta UI vendor/admin/TinyMCE. Screenshot ada di `test-results/` setelah tes. Tes tidak mengirim email ke luar; lakukan tes SMTP nyata melalui Settings pada instalasi tujuan. PostgreSQL 17 dan MySQL 8.4 masing-masing lulus 14 tes integrasi. Status build Docker dan pemeriksaan akhir dicatat di VERIFIKASI.md.

## Referensi implementasi

- [Prisma data sources](https://docs.prisma.io/docs/orm/v6/prisma-schema/overview/data-sources)
- [TinyMCE React self-hosted](https://www.tiny.cloud/docs/tinymce/latest/react-ref/)
- [Playwright PDF](https://playwright.dev/docs/api/class-page#page-pdf)

Pengujian provider produksi dapat diulang terhadap **database uji kosong** dengan `TEST_DATABASE_URL` dan `node scripts/provider-test.js postgresql` atau `node scripts/provider-test.js mysql`. Helper mengembalikan client lokal ke provider di `.env` setelah pengujian selesai.

Pembaruan 2 November 2026: Email Anda pada form Internal memakai delapan pilihan radio sesuai gambar pengguna; alamat terpilih tetap menjadi default tujuan email ROI. Form Eksternal tetap memakai isian email bebas. Jalankan `node scripts/update-internal-email.js` untuk menerapkan pembaruan pada database lama; instalasi baru mendapatkannya dari seed.

Menu Editor Ketentuan menyediakan sakelar ON/OFF per mode. OFF melewati halaman persetujuan dan field paham_ketentuan tanpa menghapus isi/versi. ON kembali mewajibkan persetujuan. Perubahan dicatat pada Activity Log; draft yang memakai status lama ditolak sampai dimuat ulang. Status dan persetujuan disimpan pada snapshot documentSettings submission.

Halaman `/` membuka pencarian Receipt of Invoice berdasarkan nomor referensi atau berdasarkan nomor buku, tahun buku, dan mode. Browser dengan sesi penyerahan yang masih aktif dapat langsung mengunduh dokumen. Di sesi lain, masukkan email saat penyerahan untuk meminta PDF ke alamat yang tercatat. Pengiriman bergantung pada pengaturan SMTP.

Tautan `/internal` dan `/eksternal` tersedia di bawah pencarian. Masing-masing memuat form dan ketentuan sesuai mode. Akses admin tersedia di `/admin`.

Email menggunakan SMTP melalui Settings → Email / SMTP. Fitur login Google/Outlook telah dihapus; konfigurasi host, port, user, password dan pengirim tetap tersedia. Pilih Tidak aktif untuk menonaktifkan pengiriman.

## Batas tanggal pada Form Builder
Pilih pertanyaan bertipe Tanggal, buka Validasi lanjutan, lalu isi Maksimal bulan ke belakang dari hari ini (contoh: 6). Centang Tidak boleh memilih tanggal setelah hari ini untuk membatasi sampai hari ini. Batas awal/akhir tetap juga tersedia; jika digabung, batas terketat berlaku. Simpan versi form agar aturan aktif. Pengaturan baru tidak diaktifkan otomatis pada form lama. Kalender, review, dan server memakai aturan yang sama sesuai zona waktu aplikasi (default Asia/Jakarta). Hitungan memakai bulan kalender, inklusif; akhir bulan dipangkas ke hari terakhir bulan tujuan (31 Agustus dikurangi 6 bulan menjadi 28/29 Februari).

Pada form awal, nomor 1 adalah paham_ketentuan. Setelah pembaruan 12 November 2026, pertanyaan yang tersembunyi ini dihapus dari versi aktif Internal: pertanyaan pertama sekarang Email anda. Eksternal tetap memakai paham_ketentuan karena masih tampil. Nomor daftar bukan nomor kolom PDF; jawaban paham_ketentuan tidak dicetak pada template dokumen bawaan.

## Pilihan backup di Tabel Kustom
Tombol **Backup tabel** membuka daftar waktu cadangan mode aktif. Pilih tanggal/waktu untuk melihat pratinjau read-only (50 baris pertama) dan mengunduh **XLSX**, **CSV**, atau **JSON**. XLSX mempertahankan warna dan status kolom tersembunyi; CSV memuat semua kolom tanpa warna; JSON menyimpan kolom, baris, sel, warna, urutan/visibilitas dan view lengkap. Semua baris disertakan dalam unduhan. Memilih backup tidak mengganti tabel kerja.

Cadangan tabel dibaca dari snapshot konsisten dalam arsip backup terenkripsi yang sudah ada, termasuk arsip lama. Scheduler tetap 00:00 dan 12:00 Asia/Jakarta (WIB), retensi default 30 hari. Daftar mencakup backup terjadwal, manual, dan backup pengaman; pembuatan saat mengejar jadwal yang terlewat dapat berbeda dari jam slot. Jadwal dapat diatur melalui Settings. Aplikasi harus menyala agar backup tepat waktu. Admin biasa dapat membaca/mengekspor hanya tabel kustom mode session aktif; arsip database lengkap dan restore global tetap khusus Super Admin di Logs & Backup. Tidak ada restore otomatis saat memilih backup.

## Pertanyaan pemahaman ketentuan yang tersembunyi
Pembaruan atas permintaan pengguna 12 November 2026: script **node scripts/remove-hidden-consent.js** membuat backup pengaman, lalu menghapus paham_ketentuan dari versi form aktif hanya pada mode yang pertanyaannya tidak tampil (Ketentuan OFF atau field nonaktif). Pada instalasi lokal kondisi ini berlaku untuk **Internal**, sedangkan **Eksternal tetap memakai pertanyaan tersebut** karena masih tampil. Versi lama dan jawaban historis tetap utuh; definisi historis ditandai nonaktif. Jika section menunjuk pertanyaan yang dibuang, target awal disesuaikan; referensi percabangan yang tidak valid ditolak. Form baru dimuat ulang sebelum submit. Persetujuan checkbox pada halaman Ketentuan ON tetap wajib. Tidak ada perubahan skema database.

## Pembaruan keamanan 13 November 2026
Placeholder setting pada template dibatasi ke metadata dokumen: nama_aplikasi, nama_perusahaan, kop, penerima_nama, kode_form, zona_waktu dan logo. Setting SMTP, token OAuth, kebijakan keamanan, dan setting lain tidak diteruskan ke render/pratinjau.

Password admin dibatasi maksimal **72 byte UTF-8** pada pembuatan, perubahan, seed dan login, agar bcrypt tidak mengabaikan bagian akhir. Untuk huruf ASCII batas ini sama dengan 72 karakter; emoji/huruf multibyte dapat mencapai batas lebih cepat. Jika akun lama memakai password di atas 72 byte, password perlu diatur ulang melalui Super Admin/pengelola server. Akun dan password yang berada dalam batas ini tidak berubah. Tidak ada migrasi database.

Tabel kustom menolak tanggal kalender yang tidak nyata, parameter pagination pecahan dibulatkan dengan aman, dan restore memulihkan folder upload asli bila pemasangan folder pengganti gagal. Pengujian PDF melalui HTTP memakai Fetch seperti frontend dan tetap memeriksa status, content-type, serta byte PDF sebenarnya.

## Uji volume 10.000 baris per mode
Jalankan npm.cmd run test:volume untuk dataset sintetis terpisah (10.000 Internal dan 10.000 Eksternal, dengan salinan kustom). Pengujian menggunakan client SQLite yang sudah tersedia dan Chromium; tidak menambah data ke database operasional. Hasil 13 November 2026 menunjukkan hambatan pencarian/ekspor Tabel Kustom, meskipun master dan backup/restore berhasil. Lihat HASIL_UJI_10000_2026-11-13.md dan test-results/volume-10000.json. Database uji dipertahankan dalam data/volume-test-*; alokasikan ruang/RAM yang cukup dan jalankan di mesin uji. Ini uji volume tersimpan, bukan 20.000 pengguna bersamaan.

## Data uji PostgreSQL yang tersedia
Tersedia tambahan 10.000 data acak per mode, berlabel DATA UJI dan nomor berawalan UJI-. Termasuk data lama, total master/salinan kustom adalah 10.004 Internal dan 10.001 Eksternal. Akun dan urutan nomor invoice asli dipertahankan. Panduan menjalankan, membersihkan demo, backup dan batas performa: POSTGRESQL.md.


## Pembukuan per tahun dan optimasi Tabel Kustom (16 November 2026)

Data Form dan Tabel Kustom memiliki pemilih **Tahun buku**, **Tahun berjalan**, dan **Semua tahun**. Tahun buku mengikuti **tanggal invoice** sesuai pilihan pengguna. Pada tampilan semua tahun, baris dikelompokkan menurut tahun. Tahun berjalan mengikuti zona waktu Settings; data tahun lama tetap tersedia lewat pemilih tahun.

**No. Buku** adalah nomor tersimpan yang dimulai dari 1 per mode dan tahun, bukan nomor posisi halaman. Mencari/mengurutkan/membuka halaman lain tidak mengubahnya. Master dan salinan awal memakai nomor yang sama; baris manual memakai rangkaian buku yang sama, sehingga daftar master dapat mempunyai celah karena nomor sudah dipakai baris manual. Nomor yang dihapus/dibatalkan tidak dipakai ulang. ID unik database dan nomor referensi ROI lama tetap utuh; nomor ROI tetap mengikuti format serta counter dokumen yang sudah ada. Contoh: invoice bertanggal 2027-01-01 masuk buku 2027 nomor 1, walaupun diterima pada 2026; invoice 2026 yang diterima 2027 masuk buku 2026 dan melanjutkan nomor buku 2026.

Jika tanggal invoice tidak ada, master memakai tahun penerimaan; baris manual memakai tahun buku yang dipilih. Mengisi/mengoreksi tanggal invoice kustom ke tahun lain memindahkan baris ke buku tujuan dengan nomor baru. Jika tanggal salinan master dikosongkan, kembali ke tahun penerimaan. Perpindahan dan tanggal dapat di-Undo/Redo bersama; data master tetap utuh. Nomor yang sudah dicadangkan tidak dimundurkan oleh Undo atau pembersihan demo. Data uji yang sudah ada mendapat No. Buku saat migrasi; pembersihan demo dapat menyisakan celah nomor buku, sementara counter referensi ROI asli tetap terpisah.

Pembaruan instalasi: hentikan server, buat backup, jalankan npm.cmd run db:prepare, npm.cmd run db:migrate, npm.cmd run build, lalu npm.cmd start. Migration 202611160001_annual_books menambah kolom nullable dan indeks; backfill satu kali mengisi metadata secara deterministik, tanpa mengganti ID/jawaban/warna. Generate client saat server berhenti untuk menghindari DLL terkunci pada Windows. Start/restore juga memeriksa backfill yang diperlukan. Arsip lama tetap dapat direstore; nomor buku belum tersimpan pada arsip sebelum fitur ini, sehingga direkonstruksi saat restore.

Uji fungsi: npm.cmd run test:postgres. Ukur ulang performa tabel pada aplikasi lokal yang sudah berjalan: npm.cmd run test:custom-performance. Perintah performa membaca data aktif, mengunduh/memverifikasi ekspor sementara di DATA_DIR/performance-downloads, lalu menghapus file sementara tersebut; login/logout/ekspor masuk log. Tidak mengubah jawaban/sel. Chromium diperlukan untuk pengukuran browser. Hasil ada di test-results/custom-performance-after.json. Pengukuran ini bukan simulasi banyak pengguna serentak.


## Notifikasi antaradmin (16 November 2026)

Menu **Notifikasi** dan tombol **🔔 Notifikasi** di header menyediakan pesan/pengingat pribadi atau antaradmin, pilihan penerima/semua admin, prioritas, penjadwalan sekali, kotak masuk, status baca per akun, dan pembatalan pesan. Pesan terpisah per mode, diperiksa tiap 15 detik dan tetap tersedia saat penerima login setelah jadwal lewat. Notifikasi hanya di aplikasi, bukan email/push saat laptop mati. Backup/restore menyertakan pesan/status baca dan tetap mendukung arsip lama. Panduan serta endpoint: [NOTIFIKASI_ADMIN.md](NOTIFIKASI_ADMIN.md).


Pembaruan pop-up header: tombol 🔔 membuka dialog lima notifikasi terbaru tanpa berpindah halaman. Dapat menandai satu/semua pesan dibaca dan membuka daftar lengkap. Tutup melalui tombol ×, klik luar dialog, atau Escape; fokus keyboard kembali ke tombol 🔔. Pop-up responsif, memperbarui pesan saat terbuka, dan memakai hak akses mode/penerima yang sama dengan kotak masuk.


Audit pop-up terbaru: [AUDIT_POPUP_2026-11-16.md](AUDIT_POPUP_2026-11-16.md). Dua bug diperbaiki: sinkronisasi status baca pop-up/daftar dan pencegahan Ctrl+Z/Ctrl+Y mengubah tabel di belakang dialog. Suite PostgreSQL 82/82 serta tes terarah akhir 9/9 lulus.

## Placeholder pembukuan (17 November 2026)

Template Dokumen menyediakan `{{nomor_buku}}` (nomor urut master per mode/tahun) dan `{{tahun_buku}}` (tahun buku berdasarkan tanggal invoice). Contoh penempatan: `No. Buku: {{nomor_buku}} / {{tahun_buku}}`. Nilai bersumber dari metadata submission master; edit Tabel Kustom tidak mengubah dokumen. Nilai jawaban vendor dengan nama yang sama tidak dapat menimpanya. Metadata yang belum tersedia ditampilkan sebagai `-`.

`{{nomor_referensi}}` tetap nomor ROI; `{{tahun}}` tetap tahun penerimaan. Tata letak/template tersimpan tidak diubah otomatis. Tambahkan placeholder melalui Admin > Template Dokumen. Pratinjau memakai nomor 1 dan tahun tanggal invoice contoh; JSON contoh dapat memuat `"nomor_buku": 42, "tahun_buku": 2026` untuk pengujian. PDF dan lampiran email memakai metadata yang sama dengan HTML. Tidak diperlukan migration database.

## Ringkasan admin dengan tahun buku

Ringkasan kini menampilkan satu notifikasi yang bisa digeser, lima kartu indikator, tren harian/bulanan, nilai per mata uang, Top 10 vendor, komposisi, sumber permintaan, status email, waktu pengisian dan tindak lanjut dengan filter Data Form. Definisi angka, aturan periode, migration indeks, cara pembaruan dan hasil uji tersedia di [RINGKASAN_ADMIN.md](RINGKASAN_ADMIN.md). Seluruh agregat dibatasi mode/tahun buku dan dibaca per batch 500; grafik tidak memakai paket baru.

Audit kode terbaru: [AUDIT_KODE_2026-11-17.md](AUDIT_KODE_2026-11-17.md). Respons pencarian/tab log yang terlambat dan error login/logout serentak diperbaiki; suite akhir PostgreSQL 97/97 lulus.

Pembaruan email: konfigurasi OAuth Google/Microsoft dan login akun pengirim telah dihapus. SMTP merupakan satu-satunya metode pengiriman yang didukung.

Audit terbaru 18 November 2026: [AUDIT_KODE_2026-11-18.md](AUDIT_KODE_2026-11-18.md), mencakup perbaikan konkurensi OAuth dan temuan dependensi alat build yang masih terbuka.

## Ukuran huruf ketentuan

Kontrol ukuran TinyMCE menggunakan px: angka 14 berarti 14px, angka 18 berarti 18px. Nilai pt masih dapat dipakai jika ditulis eksplisit, tetapi 18pt setara 24px dan 14pt sekitar 18,67px. HTML lama tidak diubah otomatis. Blok teks lalu pilih/ketik ukuran yang diinginkan untuk mengganti format sebelumnya. Gaya dasar ketentuan pada editor, pratinjau dan publik menggunakan satu sumber di client/src/terms-content.css, termasuk heading; ukuran font tidak lagi berubah otomatis pada HP. Format inline yang disimpan tetap dihormati.

## Gambar pada ketentuan

Unggahan gambar ditunggu sampai selesai sebelum autosave/simpan/publikasi; jika gagal, versi sebelumnya tetap dipakai. Gunakan **Sisipkan gambar tersimpan** untuk memasukkan kembali foto yang pernah diunggah pada mode aktif tanpa unggah ulang. Referensi gambar yang sudah terhapus dari isi tidak dipulihkan ke posisi tebakan. Panduan dan bukti: [PERBAIKAN_GAMBAR_KETENTUAN_2026-11-18.md](PERBAIKAN_GAMBAR_KETENTUAN_2026-11-18.md).

Audit alur terbaru: [AUDIT_FLOW_2026-11-18.md](AUDIT_FLOW_2026-11-18.md). Tiga masalah rollback ketentuan diperbaiki; suite PostgreSQL 117/117 lulus, ekspor/pencarian pada 10.000+ baris per mode diverifikasi tanpa mengubah data aktif. Empat peringatan dependensi alat build tetap dicatat sebagai temuan terbuka.

Testing terbaru 19 November 2026: [TESTING_2026-11-19.md](TESTING_2026-11-19.md). Seluruh 117 tes lulus. Audit npm saat ini 0 peringatan; advisori yang mendasari empat peringatan pada laporan sebelumnya telah dicabut, tanpa perubahan versi dependensi.

## Placeholder subjek dan isi email

Settings > Email / SMTP mendukung placeholder pada **Subjek email** dan **Isi email**, untuk SMTP. Contoh subjek: `Receipt of Invoice — Buku {{nomor_buku}} / {{tahun_buku}}`. Contoh isi: `Terima kasih {{received_from}}. Invoice {{invoice_number}} senilai {{currency}} {{format_number total}} diterima dengan referensi {{nomor_referensi}}.`

Daftar placeholder dapat dibuka dan disalin di Settings. Semua kode field (termasuk field kustom) dapat dipakai; nilai kosong/tidak tersedia menghasilkan teks kosong. `{{nomor_buku}}` dan `{{tahun_buku}}` mengambil metadata master per mode/tahun berdasarkan tanggal invoice, sedangkan `{{tahun}}` adalah tahun penerimaan. Metadata yang belum tersedia ditampilkan `-`. Total dihitung server dari amount_nett + vat. Nilai master dan setting dokumen saat submission dipakai agar konsisten dengan PDF, termasuk saat kirim ulang; perubahan Tabel Kustom tidak mengubah hasil.

Format angka: `{{format_number amount_nett}}`, `{{format_number vat}}`, `{{format_number total}}` (format Indonesia, 2 desimal). Format tanggal: `{{format_date invoice_date 'dd-MM-yyyy'}}`; tanggal kosong menghasilkan `-`. Setting publik yang didukung: nama_aplikasi, nama_perusahaan, kop, penerima_nama, kode_form, zona_waktu, logo, melalui `{{setting.kode_form}}` dan seterusnya. Password/token tidak tersedia. Isi email berupa teks biasa, tanpa HTML, blok Handlebars atau triple braces. Subjek dibersihkan dari karakter baris baru/kontrol.

**Pratinjau email** memakai teks yang sedang diedit dan data contoh No. Buku 1/tahun berjalan sesuai zona waktu, PT Contoh Vendor, total IDR 1.110.000,00; field di luar contoh dapat kosong. Pratinjau tidak menyimpan atau mengirim email. Simpan pengaturan agar berlaku untuk pengiriman berikutnya di kedua mode. **Tes kirim email** tetap hanya menguji koneksi dengan pesan tes tetap tanpa PDF. Pengaturan tersimpan lama tidak diubah otomatis. Tidak ada dependency/migration baru.

## URL menu admin

Setiap menu utama memiliki tautan yang dapat dibuka langsung, di-bookmark, dan dibuka di tab baru. Navigasi memakai History API browser tanpa dependency tambahan. Refresh serta tombol Kembali/Maju mengikuti menu dan tab yang dipilih.

| Menu | URL |
|---|---|
| Ringkasan | `/admin/{mode}/ringkasan` |
| Notifikasi | `/admin/{mode}/notifikasi` |
| Data Form | `/admin/{mode}/data-form` |
| Tabel Kustom | `/admin/{mode}/tabel-kustom` |
| Editor Ketentuan | `/admin/{mode}/ketentuan` |
| Form Builder | `/admin/{mode}/form-builder` |
| Template Dokumen | `/admin/{mode}/template` |
| Logs & Backup | `/admin/{mode}/logs-backup` |
| Settings | `/admin/settings` |

`{mode}` diisi `internal` atau `eksternal`, misalnya `/admin/internal/data-form` dan `/admin/eksternal/data-form`. Mode di URL menentukan ruang kerja; badge dan warna mengikuti URL. Dua tab dengan login yang sama dapat memakai mode berbeda. Settings tetap global dan dapat dibuka tanpa memilih mode.

Super Admin dapat membuka **Settings → Akses Menu** untuk memilih menu bawaan per role dan menambahkan pengecualian per akun. Pilihan **Ikuti role** memakai aturan bawaan, sedangkan **Izinkan** dan **Blokir** berlaku untuk akun tersebut. Aturan menu berlaku di kedua mode serta pada URL dan API langsung. Settings dan perubahan akses tetap khusus Super Admin. Backup dan restore seluruh aplikasi juga tetap memerlukan role Super Admin.

Gunakan **Tambah role**, simpan menu yang diperbolehkan, lalu tetapkan role di **Settings → Akun admin**. Role baru mulai tanpa akses menu. Izin **User** selalu terbatas pada daftar dan detail Data Form Master tanpa ekspor, unduhan dokumen atau lampiran, dan kirim ulang email. Saat role akun diganti, pengecualian menu sebelumnya dihapus dan sesi akun diakhiri.

Tab Settings menggunakan `?tab=umum|dokumen|email|keamanan|backup|unggahan|tema|akun`, misalnya `/admin/settings?tab=email`. Logs memakai `?tab=activity|email|backups`, Notifikasi memakai `?tab=inbox|sent` dengan filter `unread=1` dan `page`. Tab tidak valid memakai tab awal; Settings dan Backup/Restore tetap dibatasi role. Dialog, detail, dan tombol aksi tidak membuat URL baru.

Filter Data Form disimpan sebagai query `year`, `page`, `q`, `vendor`, `from`, `to`, `status`, `followup`, `sort`, `dir`; misalnya `/admin/{mode}/data-form?year=2026&page=2&followup=legality`. Pengetikan pencarian mengganti entri history saat ini supaya tombol Kembali tidak menelusuri setiap huruf. Tahun Ringkasan juga disimpan di `?year=2026`. Filter/tampilan lokal Tabel Kustom tetap mengikuti fitur view yang sudah ada.

`/admin` tetap dapat dipakai dan diarahkan ke Ringkasan; tautan Settings lama dengan `mail_oauth` diarahkan ke tab Email dengan informasi bahwa fitur tersebut telah dihapus. Endpoint login/callback OAuth lama mengembalikan 410 dan tidak dapat menghubungkan akun lagi. Tautan langsung yang sudah menyertakan mode tetap dipertahankan saat login dan tidak memerlukan pemilihan mode lagi. Tautan lama tanpa mode diarahkan memakai pilihan terakhir pada tab (sessionStorage), lalu default session lama bila tersedia; jika keduanya belum ada, pemilih mode ditampilkan. Mode terakhir pada tab hanya membantu navigasi tautan lama/keluar dari Settings; URL tetap menjadi sumber mode pada halaman yang sudah memiliki prefix. Tombol Pindah mode mengembalikan pengguna ke Ringkasan mode tujuan. Halaman admin yang tidak dikenal menampilkan pesan dan tautan kembali ke Ringkasan.

Express dan Vite melayani fallback SPA untuk URL tersebut. Jika frontend dipasang di server web terpisah, atur fallback berkas yang tidak ditemukan ke `index.html` untuk rute halaman; teruskan `/api`, `/uploads`, dan `/vendor` ke backend sesuai konfigurasi sebelumnya. Tidak ada migration/perubahan data untuk pembaruan navigasi ini.

Permintaan API dari halaman mode membawa header `X-ROI-Mode: internal|eksternal`. Backend memvalidasi nilai header dan memakai mode tersebut untuk query, perubahan, ekspor, unggahan, notifikasi, serta audit. ID dari mode lain tetap ditolak. Client mengikat mode pada callback asal, termasuk operasi async/unduhan, sehingga navigasi tidak mengalihkan operasi tertunda ke mode baru. API Settings, akun, koneksi email dan backup lengkap bersifat global dan tetap dibatasi role; backup lengkap tetap mencakup kedua mode. Tanpa header, API lama memakai mode session untuk kompatibilitas. Login/CSRF/role tetap wajib sesuai endpoint; mode bukan pengganti otorisasi. Email tes tanpa mode tersimpan sebagai global dan dapat dilihat dari Email Log kedua mode, tanpa mencampur invoice mode lain.

## Pengiriman email melalui SMTP

Settings > Email / SMTP menyediakan metode SMTP atau Tidak aktif. Isi host, port, user, password, pengirim, subjek dan isi email; lalu Simpan pengaturan. Password SMTP tetap terenkripsi dan tidak ditampilkan kembali. Tes kirim email mengirim pesan koneksi tanpa lampiran; pengiriman ROI melampirkan PDF dan mengisi placeholder seperti sebelumnya. Kebutuhan autentikasi SMTP mengikuti penyedia email Anda.

Pada startup dan restore, token, konfigurasi dan alur login Google/Outlook lama (`mail_oauth_*`) dibersihkan. Jika metode lama masih gmail/outlook atau tidak dikenal, pengiriman menjadi Tidak aktif agar tidak diam-diam berpindah akun SMTP. Metode SMTP yang sudah aktif dan seluruh kredensial SMTP dipertahankan. Restore backup lama tidak mengaktifkan kembali login provider. Arsip backup historis tidak ditulis ulang; data OAuth di dalamnya dibuang saat restore. Variabel environment OAuth lama tidak digunakan lagi dan dihapus dari .env.example. Tidak ada pencabutan izin di akun Google/Microsoft secara jarak jauh; jika pernah terhubung, izin lama dapat dicabut melalui pengaturan akun penyedia.
