# Ringkasan admin

Ringkasan terpisah per mode dan akun. Pilih **Tahun buku** (awal: tahun berjalan dalam zona waktu Settings) untuk seluruh angka. Tahun buku mengikuti tanggal invoice; invoice tanpa tanggal menggunakan tahun penerimaan sesuai aturan pembukuan yang sudah ada. Notifikasi mengikuti penerima/mode, tidak dibatasi tahun buku.

## Notifikasi ringkas

Satu pesan ditampilkan, paling baru dahulu. Tombol kiri/kanan, tombol panah keyboard saat panel fokus, atau swipe horizontal di HP membuka pesan lain. Pesan lama dimuat per halaman 20 sehingga navigasi tidak dibatasi lima pesan. Tidak berganti otomatis dan tidak otomatis menandai dibaca. Status mengikuti pop-up header; panel diperbarui setiap 15 detik dan saat tab aktif kembali. Tombol **Buka kotak masuk** membuka menu lengkap.

## Arti angka

| Bagian | Perhitungan |
| --- | --- |
| Total penyerahan | Jumlah master untuk mode dan tahun buku terpilih. |
| Masuk hari ini / 7 hari | Tanggal penerimaan menurut zona waktu Settings; 7 hari termasuk hari ini; tetap dibatasi tahun buku terpilih. |
| Vendor unik | Nama vendor master (fallback received_from), dirapikan spasi dan disamakan huruf besar/kecil; nama kosong tidak dihitung. Ini belum merupakan identitas NPWP vendor. |
| Tren 30 hari | Jumlah penerimaan per hari, termasuk hari dengan nol data. |
| Tren per bulan | Bulan tanggal invoice dalam tahun buku, bukan bulan penerimaan. Tanpa tanggal invoice memakai bulan penerimaan. Grafik harian lebih sesuai untuk beban kerja terkini. |
| Nilai tagihan | amount_nett + vat yang tersimpan di master. Total lama di values.total tidak dipercaya. Angka dijumlah dalam unit 0,01 menggunakan BigInt dan dikirim sebagai string desimal. Mata uang tidak pernah dijumlah bersama; mata uang kosong masuk kategori Tidak diisi. |
| Top 10 vendor | Dapat diurutkan berdasarkan jumlah penyerahan atau nilai per mata uang. Pada peringkat nilai, jumlah penyerahan juga mengikuti mata uang terpilih. Tidak ada peringkat nilai gabungan lintas mata uang. |
| Komposisi | PPN: ada_ppn. Jasa: invoice_jasa. Subvendor: Ya jika salah satu ada_subvendor_1..4 adalah Ya; Tidak jika pertanyaan pertama Tidak tanpa jawaban Ya berikutnya. Jawaban kosong/tidak dikenal dipisahkan dari Tidak. |
| Sumber permintaan | Jawaban permintaan_via, dikelompokkan tanpa membedakan huruf besar/kecil. Opsi gabungan Telepon/WhatsApp tetap gabungan karena tidak dapat ditebak salurannya. |
| Status email | Semua percobaan kirim berhasil/gagal yang terkait invoice tahun buku terpilih; email tes tanpa invoice tidak dihitung. Email Log membuka riwayat lengkap mode aktif. |
| Waktu rata-rata | submittedAt - startedAt, termasuk jeda/draft. Waktu negatif/tidak valid dikecualikan dan jumlah pengecualiannya terlihat. Bukan waktu mengetik aktif. |
| Tindak lanjut | Legalitas: jawaban Belum. Email: percobaan terakhir per invoice berstatus gagal; setelah kirim ulang berhasil, invoice keluar dari daftar. Maksimal lima contoh per kategori, tautan membuka Data Form dengan tahun buku dan filter yang cocok. |

Gunakan **Perbarui ringkasan** untuk menghitung ulang setelah ada data baru. Agregasi membaca master per batch 500, bukan mengirim semua jawaban ke browser. Ini membatasi pemakaian memori jawaban, tetapi waktu hitung tetap bertambah seiring jumlah data. Tidak ada paket grafik baru; grafik SVG menyertakan judul/tooltip dan daftar angka yang dapat dibuka.

## API dan pembaruan

- GET /api/admin/dashboard?year=current atau ?year=2026. Parameter all ditolak karena Ringkasan memerlukan satu tahun buku.
- GET /api/admin/submissions?year=2026&followup=legality atau followup=email. Filter berlaku juga pada ekspor CSV/XLSX, pencarian, sorting dan pagination.
- Migration 202611170001_dashboard_email_index menambah indeks email (mode, submissionId, createdAt, id), tanpa mengubah isi data.
- Instalasi yang sudah ada: npm.cmd run db:migrate lalu npm.cmd run build dan jalankan ulang aplikasi. Tidak perlu seed ulang.

## Verifikasi 17 November 2026

Suite penuh PostgreSQL 89/89 lulus; pengujian akhir terarah dicatat di test-results/dashboard-analytics-final-target.log. Kasus baru mencakup >500 baris, batas hari WIB/tahun invoice berbeda tahun terima, pembulatan desimal/mata uang, status kosong, kirim ulang berhasil, isolasi mode/tahun, query berparameter, halaman kedua tindak lanjut, ekspor, carousel >20 pesan, keyboard, swipe, tautan dan mobile. Screenshot test-results/dashboard-desktop.png dan dashboard-mobile.png menggunakan data uji.

Pengukuran akhir baca data aktif, tiga sampel: Internal 10.004 baris, payload 6.698 byte, 639/605/490 ms; Eksternal 10.002 baris, payload 7.452 byte, 609/663/604 ms. Jumlah master/salinan/sel/notifikasi/penerima sebelum-sesudah sama; tidak ada pesan nyata ditandai dibaca dan tidak mengirim email. Login/logout tercatat di activity log. Ini pengukuran satu pengguna, bukan uji banyak pengguna serentak. Bukti lokal: test-results/dashboard-live-performance.json.
