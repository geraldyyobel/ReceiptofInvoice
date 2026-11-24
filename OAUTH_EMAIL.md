# Login Google/Outlook telah dihapus

Aplikasi sekarang menggunakan SMTP untuk mengirim email. Gunakan **Admin → Settings → Email / SMTP** untuk mengisi host, port, user, password dan pengirim, lalu simpan dan jalankan tes kirim email. Placeholder subjek/isi email tetap didukung.

Tombol login, konfigurasi OAuth dan pengiriman Gmail API/Microsoft Graph sudah dihapus. Endpoint lama mengembalikan 410. Token/konfigurasi lama dibersihkan ketika startup dan restore; metode gmail/outlook lama menjadi Tidak aktif, tanpa menimpa kredensial SMTP. Backup historis tetap dipertahankan dan dibersihkan dari OAuth saat dipulihkan.

Aplikasi tidak menghubungi penyedia untuk mencabut izin akun. Jika pernah menghubungkan akun, izin lama dapat dicabut dari pengaturan akun Google/Microsoft.

Laporan audit bertanggal sebelum penghapusan fitur adalah catatan historis. Panduan aktif ada di README.md.
