# Audit alur aplikasi — 18 November 2026

Hasil akhir: **117/117 tes PostgreSQL lulus** setelah perbaikan tiga masalah rollback ketentuan. Aplikasi aktif pada http://localhost:5173. Pemeriksaan ini tidak menyatakan seluruh kemungkinan bebas bug.

## Masalah yang diperbaiki

1. Rollback ketika pratinjau terbuka memperbarui draft tetapi masih menampilkan pratinjau versi sebelumnya. Setelah berhasil rollback, pratinjau lama dibersihkan dan editor menampilkan versi yang dipulihkan.
2. Autosave lama yang belum selesai dapat menimpa draft hasil rollback. Rollback kini memakai pengunci aksi manual dan menunggu antrean autosave sebelum meminta pemulihan draft. Autosave yang belum mulai dilewati saat operasi manual aktif.
3. Tombol rollback tetap bisa diklik ketika publish/simpan berlangsung. Tombol dinonaktifkan selama operasi yang berkonflik; pengunci aksi juga mencegah permintaan manual ganda.

Ketiga skenario gagal pada reproduksi sebelum perbaikan (test-results/flow-rollback-before.log), lalu lulus pada pengujian akhir. Rollback tetap memulihkan draft saja dan tidak mempublikasikan versi secara otomatis.

## Cakupan dan bukti

- Baseline tes lama: 113/113 lulus (flow-audit-baseline.log). Ini belum mendeteksi tiga skenario rollback di atas.
- Tes terarah akhir font/gambar/rollback: 12/12 lulus (flow-rollback-after2.log).
- Suite lengkap akhir: **117/117**, 0 gagal (flow-audit-final.log). Mencakup submit publik dan percabangan, persetujuan ketentuan/on-off, versioning field/template, nomor buku tahunan, validasi, akses/CSRF/role, mode terpisah, upload, PDF dan email/OAuth mock, tabel kustom/sinkronisasi/Undo/Redo/ekspor, notifikasi/carousel, Ringkasan, backup/restore serta kasus respons asinkron dan transaksi bersamaan.
- Build, pemeriksaan sintaks seluruh server/shared/scripts dan git diff --check berhasil.
- Pada satu percobaan terarah, inisialisasi TinyMCE timeout sebelum skenario unggahan gagal dimulai. Kasus tersebut lulus saat diulang dan pada suite penuh akhir. Ditambahkan diagnostik kondisi halaman untuk membantu jika berulang; penyebab timeout tunggal itu belum dipastikan dan tidak diklaim telah ditemukan sebagai bug fungsional baru.
- Aplikasi yang aktif dipakai untuk pengukuran baca data dan ekspor; tidak melakukan submit, perubahan sel, rollback, publikasi atau restore data operasional.

## Uji data aktif

| Pemeriksaan | Internal | Eksternal |
| --- | --- | --- |
| Jumlah baris kustom | 10.004 | 10.002 |
| Halaman API 50 baris (median 3 sampel) | 45 ms | 49 ms |
| Pencarian tanpa hasil API (median) | 256 ms | 255 ms |
| Sorting angka API (median) | 72 ms | 97 ms |
| Buka tabel di browser | 360 ms | 384 ms |
| Pencarian browser | 897 ms | 873 ms |
| CSV lengkap | 1.804 ms / 10.004 baris | 1.970 ms / 10.002 baris |
| XLSX lengkap | 2.703 ms / 10.004 baris | 2.621 ms / 10.002 baris |

Seluruh pengecekan health saat ekspor berhasil; latensi maksimum teramati 77 ms. Browser kedua mode tidak menghasilkan pageerror dan hanya meminta 50 baris per halaman. Ekspor sementara dihapus setelah jumlah baris diverifikasi. Bukti: test-results/flow-audit-custom-performance.json dan .log. Laporan performa historis dikembalikan ke lokasi sebelumnya setelah laporan audit baru disalin agar tidak hilang. Ini bukan pengujian beban banyak pengguna secara bersamaan atau jangka panjang.

SHA-256 sembilan tabel bisnis master/kustom/notifikasi/email log sama sebelum/sesudah, demikian pula isi ketentuan, versi, metadata dan byte file unggahan. Bukti privat di data/runtime/flow-audit-business-before.json, flow-audit-business-after.json, flow-audit-terms-integrity-before.json dan flow-audit-terms-integrity-after.json. Perubahan normal hanya login/logout/ekspor pada activity log dan session. Folder data tidak masuk Git/ZIP.

## Temuan yang masih terbuka

npm audit seluruh paket tetap melaporkan **4 peringatan high**, berasal dari picomatch dan rantai fdir/tinyglobby/Vite. Audit --omit=dev melaporkan **0 advisori runtime**. Registry pada pemeriksaan menyediakan picomatch 4.0.7; advisori [GHSA-fc5q-39xc-vjpf](https://github.com/advisories/GHSA-fc5q-39xc-vjpf) belum menyediakan versi patch. Tidak menurunkan versi mayor Vite secara paksa untuk menghilangkan laporan. Dockerfile masih memasang dependensi build; klasifikasi runtime 0 bukan jaminan seluruh deployment bebas risiko. Bukti: flow-audit-dependencies.json dan flow-audit-runtime-dependencies.json.

Pengiriman ke SMTP/Google/Outlook sungguhan, hosting/Docker produksi dan beban jangka panjang banyak pengguna tidak diuji di audit ini. Backup/restore dan email diuji di lingkungan sementara/simulasi. Tidak ada migration baru dan tidak ada push GitHub otomatis dalam pekerjaan ini.
