# Login Outlook / Gmail untuk akun pengirim ROI

Login ini menghubungkan **akun pengirim email**, terpisah dari akun admin ROI. Hanya Super Admin dapat menghubungkan, memilih, atau memutus akun. SMTP manual tetap tersedia. Akun Outlook dikirim melalui Microsoft Graph, Gmail melalui Gmail API; tidak memerlukan password mailbox di aplikasi.

## Pengaturan awal satu kali oleh pengelola server

Isi variabel yang diperlukan pada `.env` atau secret manager, lalu restart server. Rahasia tidak ditaruh di frontend dan tidak perlu dikirim melalui chat.

```dotenv
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
MICROSOFT_CLIENT_ID=
MICROSOFT_CLIENT_SECRET=
MICROSOFT_TENANT_ID=common
MAIL_OAUTH_ORIGIN=
```

`MAIL_OAUTH_ORIGIN` boleh kosong: memakai origin pertama dari `APP_ORIGIN`. Jika diisi, harus sama dengan salah satu origin aplikasi yang diizinkan. Gunakan alamat tersebut saat membuka aplikasi untuk login. Produksi wajib HTTPS; HTTP hanya diizinkan untuk localhost/loopback. Jangan memakai alamat API internal/Docker sebagai callback apabila pengguna membuka aplikasi melalui domain lain atau Vite.

Callback untuk instalasi lokal di port 5173:

```text
http://localhost:5173/api/email/oauth/outlook/callback
http://localhost:5173/api/email/oauth/gmail/callback
```

Untuk produksi, ganti origin dengan domain HTTPS aplikasi dan daftarkan URI yang sama persis. Alamat aktual ditampilkan di **Settings → Email / SMTP → Konfigurasi awal**.

## Microsoft Outlook / Microsoft 365

1. Daftarkan aplikasi **Web** di Microsoft Entra dan tambahkan redirect URI Outlook di atas.
2. Tentukan jenis akun. Untuk pemakaian hanya dalam organisasi BCU, gunakan tenant organisasi dan isi `MICROSOFT_TENANT_ID` dengan tenant ID sebenarnya. Jika aplikasi ditujukan untuk akun organisasi sekaligus Outlook/Hotmail pribadi, pilih dukungan akun organisasi dan personal, lalu gunakan `common`.
3. Tambahkan izin Microsoft Graph **delegated** `User.Read` dan `Mail.Send`. Alur meminta `offline_access` agar dapat memperbarui token. Tidak memakai izin application untuk mengirim sebagai seluruh pengguna.
4. Buat client secret, simpan **nilai secret** ke `MICROSOFT_CLIENT_SECRET` dan Application/client ID ke `MICROSOFT_CLIENT_ID`. Kebijakan tenant mungkin memerlukan persetujuan administrator Microsoft.
5. Restart ROI, buka Settings → Email / SMTP → Login Outlook, pilih akun mailbox pengirim dan setujui izin.

Lihat [pendaftaran aplikasi Microsoft](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app), [authorization code flow](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow), dan [Graph sendMail](https://learn.microsoft.com/en-us/graph/api/user-sendmail?view=graph-rest-1.0).

## Gmail / Google Workspace

1. Siapkan proyek Google Cloud, aktifkan **Gmail API**, lalu konfigurasi consent screen/audience.
2. Buat OAuth client jenis **Web application**, daftarkan redirect URI Gmail di atas, dan isi Client ID/Secret pada environment server.
3. Gunakan scope `openid`, `email`, dan `https://www.googleapis.com/auth/gmail.send`. ROI hanya meminta akses identitas dan pengiriman; tidak meminta membaca/menghapus seluruh mailbox.
4. Jika aplikasi masih dalam mode pengujian Google, masukkan akun pengirim sebagai test user. Ikuti persyaratan penerbitan/verifikasi Google untuk penggunaan operasional; izin/refresh token dapat kedaluwarsa atau dicabut.
5. Restart ROI, pilih Login Gmail, lalu setujui izin. Bila login ditolak karena browser tertanam, buka ROI menggunakan Chrome/Edge biasa. Password Google tidak dimasukkan di ROI.

Lihat [OAuth web server Google](https://developers.google.com/identity/protocols/oauth2/web-server), [scope Gmail](https://developers.google.com/workspace/gmail/api/auth/scopes), dan [masa berlaku token](https://developers.google.com/identity/protocols/oauth2).

## Pemakaian sehari-hari

- Login yang berhasil langsung memilih provider tersebut sebagai metode aktif dan mengatur pengirim sesuai akun yang terhubung. Memilih provider lain yang sudah terhubung dilakukan lewat **Metode pengiriman**, lalu Simpan pengaturan.
- SMTP manual tetap memakai pengaturan SMTP/lingkungan yang sudah ada. OAuth memakai alamat akun terhubung sebagai pengirim; tidak mendukung pemalsuan alamat/alias Send As. Hubungkan mailbox pengirim yang benar, misalnya sisteminvoice@bcupt.id jika mailbox tersebut tersedia pada provider.
- Klik **Tes kirim email** setelah konfigurasi. Status permintaan dan kegagalan muncul di Email Log. API provider menerima permintaan kirim; pantau folder Terkirim/NDR untuk hasil pengantaran sebenarnya.
- Token diperbarui otomatis. Jika izin dicabut, gunakan Hubungkan ulang. Untuk Outlook, pengiriman lampiran langsung dibatasi total 3 MB; PDF yang lebih besar ditolak dengan alasan pada Email Log.
- **Putuskan koneksi** menghapus token yang disimpan ROI. Jika metode itu sedang aktif, pengiriman berubah menjadi **Tidak aktif**, tanpa beralih diam-diam ke SMTP/provider lain. Pilih metode baru secara eksplisit. Untuk mencabut grant penyedia sepenuhnya, hapus izin aplikasi dari pengaturan akun Microsoft/Google juga.
- Logout admin tidak memutus koneksi email, sehingga pengiriman ROI tetap dapat berjalan. Kredensial/token ini berlaku global untuk kedua mode.

## Penyimpanan dan callback

Access/refresh token serta verifier OAuth disimpan terenkripsi AES-256-GCM pada baris Settings privat. Endpoint Settings dan log perubahan tidak mengekspos baris ini. Client secret tetap di environment. Backup memuat token dalam keadaan terenkripsi; perlakukan arsip dan kuncinya sebagai rahasia. Setelah restore atau rotasi rahasia, akun mungkin perlu dihubungkan ulang.

Authorization Code memakai state acak sekali pakai, PKCE S256 dan cookie binding httpOnly SameSite=Lax berumur 10 menit. Cookie session admin tetap SameSite=Strict. Callback tidak bergantung pada pengiriman cookie Strict dari situs Microsoft/Google: server memeriksa session Super Admin asli yang memulai login, role, masa berlaku, binding, dan state. Callback ditolak jika admin sudah logout atau rolenya berubah. Redirect hanya ke origin aplikasi yang dikonfigurasi.

## Verifikasi paket

Tes memakai mock endpoint token, profil, Gmail send dan Graph sendMail. Tidak ada email eksternal yang dikirim saat tes. Login provider nyata dan pengiriman ke mailbox nyata perlu diverifikasi setelah Client ID/Secret serta izin organisasi tersedia. Tombol login sengaja tidak aktif sebelum konfigurasi server lengkap.
