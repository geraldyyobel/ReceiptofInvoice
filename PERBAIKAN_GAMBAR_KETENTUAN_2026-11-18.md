# Perbaikan gambar Editor Ketentuan — 18 November 2026

Gambar berhasil diunggah ke folder server, tetapi TinyMCE mengubah URL /uploads/... menjadi alamat relatif uploads/.... Sanitizer server hanya menerima URL unggahan /uploads/... sehingga tag gambar hilang ketika menyimpan HTML. Ditemukan juga penyimpanan yang langsung memakai HTML sementara (blob/data URI) saat unggahan belum selesai.

## Perubahan

- TinyMCE mempertahankan alamat unggahan dari root aplikasi (relative_urls=false, remove_script_host=true).
- URL relatif unggahan dari editor lama dinormalisasi ke /uploads/... sebelum sanitasi. URL luar, script, event handler, dan lokasi di luar folder unggahan tetap ditolak/dihapus sesuai aturan keamanan.
- Simpan versi, Publish dan pratinjau menunggu editor.uploadImages(), kemudian mengambil HTML terbaru dari editor, bukan HTML lama dari state React.
- Autosave dijalankan berurutan dan diselesaikan/dilewati sebelum penyimpanan manual. Draft lama tidak boleh menimpa publikasi yang lebih baru.
- Unggahan gagal membatalkan simpan/publish, mempertahankan versi sebelumnya, dan memberi pesan Belum tersimpan.
- API ketentuan menolak sumber gambar sementara blob/data dengan 422 tanpa mengganti draft/versi. Tidak melonggarkan allowlist gambar.
- Permintaan editor/unggahan membawa mode asal; server menolak mode yang sudah berubah (409). Proses editor yang sudah ditutup tidak melanjutkan penyimpanan baru.
- Tombol **Sisipkan gambar tersimpan** menampilkan gambar publik yang pernah diunggah pada mode aktif, dengan pagination. Lampiran vendor privat dan gambar mode lain tidak muncul.

## Memakai kembali gambar yang hilang

1. Refresh halaman admin setelah draft yang sedang dikerjakan tersimpan.
2. Buka Editor Ketentuan pada mode yang sesuai.
3. Pilih posisi pada isi editor, lalu klik **Sisipkan gambar tersimpan**.
4. Pilih gambar, kemudian Simpan versi atau Publish ketentuan.

File lama masih tersedia. Pemeriksaan baca data aktif menemukan 1 gambar Internal dan 11 Eksternal; seluruh URL file tersebut merespons 200. Posisi gambar yang referensinya sudah hilang dari draft/publikasi tidak ditebak atau dimasukkan otomatis. Pengguna memilih posisi yang benar melalui pemilih gambar; tidak perlu unggah ulang jika file tersedia.

## Verifikasi

- Reproduksi sebelum perbaikan: gambar dari pemilih file hilang dari draft, publish terjadi saat unggahan paste masih tertahan, dan API menerima blob/data lalu membuang gambar. Bukti: test-results/terms-images-before2.log (gagal sebelum perbaikan).
- Tes terarah font/gambar: 8/8 lulus (test-results/terms-images-final-target.log), termasuk simpan/reload/publish, pratinjau, akses publik, unggahan tertunda/gagal, pemulihan tanpa unggah ulang, sanitasi dan pemisahan mode.
- Suite penuh akhir **113/113 lulus**, termasuk pengaman mode asal, dan build berhasil: test-results/terms-images-final-full.log.
- API galeri live dan seluruh file gambar berhasil dibaca: test-results/terms-images-live.json. Pemeriksaan live tidak menyisipkan atau mempublikasikan gambar.
- SHA-256 isi ketentuan, versi, metadata upload dan byte file sebelum/sesudah sama. Bukti privat: data/runtime/terms-images-integrity-before.json dan terms-images-integrity-after.json.
- Tidak ada migration, perubahan data ketentuan operasional, atau pengiriman email nyata. Aplikasi dijalankan ulang setelah perubahan backend.
