export const assumptions =
  "PERLU DITINJAU: percabangan VAT/NSFP, NITKU/email bukpot serta opsi paham ketentuan, PPN, jasa, legalitas dan permintaan via adalah asumsi berdasarkan nama kolom. Form dan ketentuan Internal merupakan salinan Eksternal. Template dokumen telah diperbarui sesuai HTML yang diberikan pengguna.";
const yes = () => ["Ya", "Tidak"].map((value) => ({ value }));
const eq = (field, value = "Ya") => ({
  join: "AND",
  conditions: [{ field, operator: "eq", value }],
});
const field = (code, label, type = "short", required = true, extra = {}) => ({
  code,
  label,
  type,
  required,
  active: true,
  section: "utama",
  help: "",
  placeholder: "",
  validation: {},
  ...extra,
});
export const initialFields = [
  field(
    "paham_ketentuan",
    "Apakah anda sudah memahami Ketentuan dan Tata Cara penyampaian tagihan ke PT Bumi Cahaya Unggul?",
    "select",
    true,
    {
      options: [
        { value: "Ya" },
        {
          value: "Belum",
          action: {
            type: "end",
            message:
              "Silakan kembali membaca dan memahami ketentuan sebelum mengisi ROI.",
            returnToTerms: true,
          },
        },
      ],
    },
  ),
  field("email_anda", "Email Anda", "email"),
  field("received_from", "Received from", "short", true, {
    help: "Nama perusahaan vendor",
  }),
  field("invoice_number", "Invoice Number"),
  field("project_number", "Project Number", "short", false),
  field("invoice_date", "Date", "date", true, { help: "Tanggal invoice" }),
  field("currency", "Currency", "select", true, {
    options: ["IDR", "USD", "EUR", "SGD", "JPY", "AUD", "GBP", "CNY"].map(
      (value) => ({ value }),
    ),
    defaultValue: "IDR",
  }),
  field("amount_nett", "Amount (Nett)", "number", true, {
    help: "Tanpa pemisah ribuan; gunakan titik untuk desimal. Contoh: 1250000.50",
  }),
  field(
    "ada_ppn",
    "Apakah invoice ini ada PPN (Pajak Pertambahan Nilai)?",
    "select",
    true,
    { options: yes() },
  ),
  field("vat", "VAT", "number", true, { showIf: eq("ada_ppn") }),
  field("nsfp", "NSFP", "short", true, {
    showIf: eq("ada_ppn"),
    help: "Nomor Seri Faktur Pajak",
  }),
  field(
    "invoice_jasa",
    "Apakah Invoice ini atas tagihan Jasa?",
    "select",
    true,
    { options: yes() },
  ),
  field(
    "nitku",
    "Sebutkan NITKU Perusahaan anda untuk penerbitan Bukti Potong PPh",
    "short",
    true,
    { showIf: eq("invoice_jasa") },
  ),
  field(
    "email_bukpot",
    "Sebutkan Email guna pengiriman Bukti Potong PPh",
    "email",
    true,
    { showIf: eq("invoice_jasa") },
  ),
  ...Array.from({ length: 4 }, (_, idx) => {
    const n = idx + 1,
      prev = n === 1 ? null : `ada_subvendor_${n - 1}`;
    return [
      field(
        `ada_subvendor_${n}`,
        `Apakah terdapat Invoice dari Sub-Forwarder / Sub Vendor${n === 1 ? "" : ` ke ${n}`}?`,
        "select",
        true,
        {
          ...(prev ? { showIf: eq(prev) } : {}),
          options: [
            { value: "Ya" },
            {
              value: "Tidak",
              action: { type: "jump", target: "legalitas_terkirim" },
            },
          ],
        },
      ),
      field(`vendor_${n}_nama`, `Nama Vendor ${n}`, "short", true, {
        showIf: eq(`ada_subvendor_${n}`),
      }),
      field(`vendor_${n}_kontak`, `Kontak Vendor ${n}`, "short", true, {
        showIf: eq(`ada_subvendor_${n}`),
      }),
    ];
  }).flat(),
  field(
    "legalitas_terkirim",
    "Apakah Sudah Mengirim Legalitas ke BCU?",
    "select",
    true,
    { options: ["Sudah", "Belum"].map((value) => ({ value })) },
  ),
  field("legalitas_tanggal", "Tanggal Kirim Legalitas", "date", true, {
    showIf: eq("legalitas_terkirim", "Sudah"),
  }),
  field("permintaan_via", "Permintaan dari BCU melalui", "select", true, {
    options: ["Email", "Telepon/WhatsApp", "Purchase Order", "Lainnya"].map(
      (value) => ({ value }),
    ),
  }),
  field("po_number", "PO. No."),
];
export const initialTerms = `<h1>KETENTUAN DAN TATA CARA PENYAMPAIAN TAGIHAN KE PT BUMI CAHAYA UNGGUL</h1>
<h2>1. Waktu Penyampaian Tagihan ke BCU</h2><ul>
<li>Tagihan disampaikan ke BCU tiap hari Senin dan Kamis, pukul 14.00-16.00 WIB.</li>
<li>Tagihan wajib disampaikan ke BCU paling lambat tanggal 10 (sepuluh) bulan berikutnya dari tanggal faktur pajak, termasuk Invoice/Faktur Pajak dari sub pemasok. (Contoh: Invoice dan Faktur Pajak PT ABA tertanggal 12 Januari 2026 wajib disampaikan ke BCU paling lambat tanggal 10 Februari 2026.)</li>
<li>Khusus akhir tahun 2026, Invoice dan Faktur Pajak tahun 2026 wajib disampaikan paling lambat tanggal 11 Desember 2026. (Contoh: Invoice dan Faktur Pajak PT ABA tertanggal 9 Desember 2026 wajib disampaikan ke BCU paling lambat tanggal 11 Desember 2026.) Kecuali invoice atas pajak dalam rangka impor.</li></ul>
<h2>2. Dokumen yang dilampirkan saat penyampaian tagihan</h2>
<h3>2.1 Form Receipt of Invoice</h3><ul><li>Wajib mengisi e-form receipt of invoice dengan lengkap dan benar sesuai petunjuk pengisian.</li><li>Mencetak receipt of invoice sebanyak 2 (dua) rangkap yang berasal dari email balasan: sisteminvoice@bcupt.id, subject &quot;Receipt of Invoice&quot;.</li></ul>
<h3>2.2 Ketentuan dokumen tagihan dan lampiran</h3>
<h4>2.2.1 Pembelian Barang oleh BCU</h4><ul><li>PO dibubuhi tanda tangan pemasok dan BCU serta distempel.</li><li>Asli Surat Jalan/Delivery Order/Packing List yang telah dibubuhi nama, tanggal, tanda tangan, stempel pemasok &amp; PIC BCU.</li><li>Asli Invoice dan Kuitansi bermeterai cukup.</li><li>Asli Faktur Pajak sebanyak 2 (dua) rangkap.</li></ul>
<h4>2.2.2 Pembelian Jasa oleh BCU</h4><ul><li>PO dibubuhi tanda tangan pemasok dan BCU serta distempel.</li><li>Asli Berita Acara Penyelesaian Pekerjaan yang telah dibubuhi nama, tanggal, tanda tangan, stempel pemasok &amp; PIC BCU (dokumentasi lain seperti foto, gambar jika ada).</li><li>Asli Invoice dan Kuitansi bermeterai cukup.</li><li>Asli Faktur Pajak sebanyak 2 (dua) rangkap.</li></ul>
<h4>2.2.3 Pembelian Barang dan Jasa oleh BCU</h4><ul><li>PO dibubuhi tanda tangan pemasok dan BCU serta distempel.</li><li>Asli Surat Jalan/Delivery Order/Packing List yang telah dibubuhi nama, tanggal, tanda tangan, stempel pemasok &amp; PIC BCU.</li><li>Asli Berita Acara Penyelesaian Pekerjaan yang telah dibubuhi nama, tanggal, tanda tangan, stempel pemasok &amp; PIC BCU (dokumentasi lain seperti foto, gambar jika ada).</li><li>*) Asli Invoice dan Kuitansi bermeterai cukup.</li><li>*) Asli Faktur Pajak sebanyak 2 (dua) rangkap.</li></ul><p>Keterangan *): Jika terdapat termin bayar (uang muka), maka Invoice dan Faktur Pajak dibuat terpisah masing-masing untuk barang dan jasa.</p>
<h4>2.2.4 Persewaan kendaraan dan jasa pengiriman barang</h4><ul><li>Asli Invoice dan Kuitansi bermeterai cukup.</li><li>Asli Faktur Pajak sebanyak 2 (dua) rangkap.</li><li>Bukti bahwa barang yang diantar telah diterima oleh penerima sesuai instruksi BCU.</li><li>Khusus persewaan kendaraan, wajib melampirkan copy STNK kendaraan dan copy SIM/KTP supir pemasok.</li></ul>
<h4>2.2.5 Jasa Impor (Freight Charge, inklaring, handling, dll.)</h4><ul><li>Asli Invoice dan Kuitansi bermeterai cukup.</li><li>Asli Faktur Pajak sebanyak 2 (dua) rangkap.</li><li>HAWB atau B/L.</li><li>Copy Commercial Invoice dan Packing List atas barang yang diurus.</li></ul>
<h3>2.3 Ketentuan dokumen perpajakan dan perizinan pemasok</h3><ul><li>NIB, NPWP, SPPKP, SBU Konstruksi (bagi pemasok konstruksi), Surat Keterangan Bebas PPh 23 (jika ada), surat perizinan lain (jika ada) → untuk penagihan yang disampaikan mulai tanggal 10 Oktober 2024.</li><li>Dokumen pada butir 2.3 wajib disampaikan ke BCU setiap 6 (enam) bulan sekali, sejak penyampaian pertama kali pada 10 Oktober 2024, atau disampaikan segera kepada BCU pada saat terjadi perubahan terkait dokumen perpajakan dan perizinan pemasok.</li></ul>
<h2>3. Ketentuan penerbitan/penulisan faktur pajak</h2><ul>
<li>Wajib mencantumkan nama, NPWP, dan alamat BCU sebagaimana NPWP di bawah ini: <strong style="background-color:#fff0bb">[ADMIN MENGISI DATA NPWP BCU DI EDITOR]</strong></li>
<li>Kolom Harga Jual/Penggantian/Uang Muka/Termin adalah sebesar 100% nilai PO BCU, berlaku juga untuk Faktur Pajak Uang Muka/termin. Contoh: BCU membeli seragam ke PT ABC sebesar IDR 6.875.000,- dengan termin pembayaran 30% uang muka dan 70% pelunasan. Maka kolom Keterangan BKP/JKP dan kolom Harga Jual/Penggantian/Uang Muka/Termin pada faktur pajak uang muka 30% adalah sebagai berikut: <strong style="background-color:#fff0bb">[ADMIN MELENGKAPI CONTOH/TABEL]</strong></li>
<li>Kolom Keterangan BKP/JKP sama dengan deskripsi barang/jasa yang tercantum dalam PO BCU (jika melebihi jumlah karakter pada database e-faktur, boleh ditulis &quot;deskripsi sesuai PO BCU No. ...&quot;).</li>
<li>Referensi Faktur Pajak sekurangnya memuat Nomor Invoice Pemasok.</li>
<li>Tanggal Faktur Pajak sama dengan tanggal Invoice. Khusus Faktur Pajak Uang Muka, paling lambat diterbitkan pada saat pembayaran uang muka oleh BCU.</li>
<li>Nama penandatangan faktur pajak diisi dengan nama dan Tanda Tangan Elektronik pejabat/pegawai pemasok yang telah ditunjuk untuk menandatangani Faktur Pajak (bukan nama perusahaan pemasok).</li>
<li>Ketentuan khusus Faktur Pajak Pengganti: tanggal Faktur Pajak Pengganti sama dengan tanggal Faktur Pajak Pengganti itu dibuat oleh pemasok. (Contoh: tanggal Faktur Pajak Normal 3 September 2024, Faktur Pajak Pengganti dibuat pemasok 17 September 2024, maka tanggal Faktur Pajak Pengganti adalah 17 September 2024.) Catatan khusus: Tanggal Invoice tetap menggunakan tanggal Faktur Pajak normal.</li></ul>`;
export const initialTemplate = `<!doctype html><html lang="id"><head><meta charset="utf-8"><title>Receipt of Invoice</title><style>
@page{size:A4;margin:14mm}*{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#111;font-size:11px;margin:0}h1{font-size:20px;margin:0}h2{font-size:17px;margin:8px 0}.head{text-align:center;border-bottom:3px double #222;padding-bottom:12px}.ref{text-align:right;margin:12px 0}.data{width:100%;border-collapse:collapse}.data td,.data th{border:1px solid #222;padding:7px;text-align:left}.label{width:30%;background:#f5f5f5}.box{border:1px solid #111;padding:10px;margin-top:15px}.signature{display:grid;grid-template-columns:1fr 1fr;gap:20px}.space{height:55px}.muted{font-size:9px}.voucher{border:1px dashed #222;padding:12px;margin-top:18px}@media print{body{margin:0}.box,.signature{break-inside:avoid}}
</style></head><body><div class="head"><h1>{{setting.nama_perusahaan}}</h1><p>{{setting.kop}}</p><h2>RECEIPT OF INVOICE</h2></div><div class="ref">No.: <b>{{nomor_referensi}}</b></div>
<table class="data"><tbody><tr><td class="label">Received From</td><td>{{received_from}}</td></tr><tr><td class="label">Invoice No.</td><td>{{invoice_number}}</td></tr><tr><td class="label">Date</td><td>{{format_date invoice_date 'dd-MM-yyyy'}}</td></tr><tr><td class="label">Currency</td><td>{{currency}}</td></tr><tr><td class="label">Amount (NETT)</td><td>{{format_number amount_nett}}</td></tr><tr><td class="label">VAT</td><td>{{format_number vat}}</td></tr><tr><td class="label">NSFP</td><td>{{nsfp}}</td></tr><tr><td class="label">Total (Include VAT)</td><td><b>{{format_number total}}</b></td></tr><tr><td class="label">PO. No.</td><td>{{po_number}}</td></tr><tr><td class="label">Submitted Legality Docs</td><td>{{legalitas_terkirim}} {{format_date legalitas_tanggal 'dd-MM-yyyy'}}</td></tr><tr><td class="label">NITKU</td><td>{{nitku}}</td></tr><tr><td class="label">Sub Vendor - 1</td><td>{{vendor_1_nama}} {{vendor_1_kontak}}</td></tr><tr><td class="label">Sub Vendor - 2</td><td>{{vendor_2_nama}} {{vendor_2_kontak}}</td></tr><tr><td class="label">Sub Vendor - 3</td><td>{{vendor_3_nama}} {{vendor_3_kontak}}</td></tr><tr><td class="label">Sub Vendor - 4</td><td>{{vendor_4_nama}} {{vendor_4_kontak}}</td></tr></tbody></table>
<div class="signature"><div class="box">Received by<div class="space"></div><p>( {{setting.penerima_nama}} )</p><p>Date: ____ / ____ / {{tahun}}</p></div><div class="box"><b>MONITOR Information</b><p>Amount to Pay: {{currency}} __________________</p><p>Due Date: ____ / ____ / {{tahun}}</p><p>Payment Date: ____ / ____ / {{tahun}}</p></div></div><div class="box signature"><div>Prepared by<div class="space"></div>( ____________________ )</div><div>Approved by<div class="space"></div>( ____________________ )</div></div><div class="voucher">Voucher No.: _______________________ &nbsp; Date: ____ / ____ / {{tahun}}</div><p class="muted">{{setting.kode_form}}</p></body></html>`;
export const defaults = {
  nama_aplikasi: "Receipt of Invoice · BCU",
  nama_perusahaan: "PT. Bumi Cahaya Unggul",
  kop: "Receipt of Invoice",
  logo: "",
  zona_waktu: "Asia/Jakarta",
  format_nomor: "ROI-{MODE}-{YEAR}-{SEQ:6}",
  penerima_nama: "Eunike Sofia Kindangen",
  kode_form: "FM.F#.001",
  email_pengirim: "sisteminvoice@bcupt.id",
  email_subjek: "Receipt of Invoice",
  email_isi:
    "Terlampir Receipt of Invoice Anda. Cetak sebanyak 2 (dua) rangkap dan lampirkan bersama dokumen tagihan.",
  smtp_host: "",
  email_transport: "smtp",
  smtp_port: 587,
  smtp_user: "",
  smtp_secure: false,
  password_min: 12,
  session_hours: 8,
  login_limit: 5,
  public_limit: 30,
  email_limit: 5,
  backup_jam: "00:00",
  backup_jam_kedua: "12:00",
  backup_retensi: 30,
  backup_lokasi: "backups",
  tema_internal: "#2365ad",
  tema_eksternal: "#18784f",
  aksen_internal: "#cbdff5",
  aksen_eksternal: "#e99d42",
  upload_mb: 5,
  upload_types: ["image/png", "image/jpeg", "image/webp", "application/pdf"],
};
