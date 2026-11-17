// Template yang diberikan pengguna; perbedaan kedua mode dipertahankan.
const css = `
:root { --primary-color: #2c3e50; --border-color: #dee2e6; --text-main: #333; --text-muted: #666; }
body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; font-size: 11px; color: var(--text-main); line-height: 1.4; margin: 0; padding: 20px 0; background-color: #525659; }
.a4-paper { width: 210mm; min-height: auto; padding: 12mm 15mm 20mm 15mm; margin: 0 auto; background: #fff; box-sizing: border-box; box-shadow: 0 4px 10px rgba(0,0,0,0.3); position: relative; }
.header-top { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid var(--primary-color); padding-bottom: 10px; margin-bottom: 15px; }
.company-info { text-align: left; margin-bottom: 0; }
.company-name { font-size: 18px; font-weight: bold; text-transform: uppercase; color: var(--primary-color); margin-bottom: 3px; }
.website-text { text-align: right; color: var(--text-muted); font-size: 11px; font-weight: bold; }
.doc-title { font-size: 20px; font-weight: bold; text-align: center; margin-top: 5px; text-decoration: underline; text-transform: uppercase; }
.doc-number { text-align: center; font-weight: bold; font-size: 13px; margin-bottom: 15px; }
.data-table { width: 100%; border-collapse: collapse; margin-bottom: 5px; }
.data-table td { padding: 2px 5px; border-bottom: 1px solid #f1f1f1; vertical-align: top; }
.label { width: 25%; font-weight: 600; color: #555; }
.colon { width: 2%; }
.value { width: 43%; font-weight: 500; }
.value-price { text-align: right; padding-right: 20px !important; }
.extra { width: 30%; color: var(--text-muted); font-size: 11px; text-align: left; padding-left: 10px; }
.amount-value { font-family: 'Courier New', Courier, monospace; font-weight: bold; font-size: 13px; }
.footer-section { display: flex; justify-content: space-between; align-items: flex-end; margin-top: 10px; }
.signature-box { text-align: left; width: 250px; }
.signature-line { margin-top: 45px; border-top: 1px solid #000; padding-top: 5px; }
.fm-code { font-size: 11px; color: var(--text-muted); text-align: right; }
.monitor-box { border: 1.5px solid var(--primary-color); padding: 10px 15px; margin-top: 15px; background-color: #fafafa; page-break-inside: avoid; }
.monitor-title { font-weight: bold; font-size: 12px; margin-bottom: 10px; color: var(--primary-color); border-bottom: 1px solid var(--border-color); padding-bottom: 5px; }
.monitor-info-row { display: grid; grid-template-columns: 1fr; gap: 5px; margin-bottom: 15px; padding-bottom: 10px; border-bottom: 1px solid #eee; }
.monitor-item { display: flex; justify-content: flex-start; align-items: baseline; }
.monitor-item { display: flex; margin-bottom: 8px; }
.m-label { width: 150px; display: flex; justify-content: space-between; margin-right: 10px; }
.m-label::after { content: ":"; }
.m-value { border-bottom: 1px dotted #ccc; flex-grow: 1; min-height: 14px; max-width: 250px; }
.signature-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
.sig-column { display: flex; flex-direction: column; justify-content: flex-start; text-align: left; min-height: 65px; }
.sig-role { font-weight: bold; font-size: 11px; color: var(--primary-color); margin-bottom: 30px; }
.sig-name { font-size: 12px; color: var(--primary-color); white-space: nowrap; }
.voucher-bottom-row { margin-top: 10px; padding-top: 10px; border-top: 1px solid #dcdcdc; display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
.v-item { display: flex; align-items: baseline; }
.v-label { color: var(--primary-color); font-weight: bold; font-size: 11px; margin-right: 5px; white-space: nowrap; }
.v-dots { border-bottom: 1px dotted #888; flex-grow: 1; min-height: 12px; }
@page { size: A4; margin: 0; }
@media print { body { background: none; padding: 0; } .a4-paper { margin: 0; box-shadow: none; width: 210mm; height: 297mm; } .monitor-box { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
`;
const row = (label, value) =>
  `<tr><td class="label">${label}</td><td class="colon">:</td><td class="value" colspan="2">${value}</td></tr>`;
const manualDate = "&emsp;&emsp; / &emsp;&emsp; / {{tahun}}";
export function documentTemplate(mode) {
  const external = mode === "eksternal";
  return `<!DOCTYPE html>
<html lang="id"><head><meta charset="UTF-8"><title>Receipt of Invoice {{nomor_referensi}}</title><style>${css}</style></head>
<body><div class="a4-paper">
<div class="header-top"><div class="company-info"><div class="company-name">PT. Bumi Cahaya Unggul</div>
${external ? "<div>Kawasan Industri Pulogadung, Jl. Rawa Kepiting No.3, Jakarta Timur 13920 - Indonesia</div><div>Phone: +62 (0)21 295584 00 | E-Mail: info@bcupt.id</div>" : "<div><p></p></div><div><p></p></div>"}
</div><div class="website-text">www.bcupt.id</div></div>
<div class="doc-title">Receipt of Invoice</div><div class="doc-number">No.: {{nomor_referensi}}</div>
<table class="data-table">
${row("Received From", "{{received_from}}")}
<tr><td class="label">Invoice No.</td><td class="colon">:</td><td class="value">{{invoice_number}}</td><td class="extra">Date: {{format_date invoice_date 'dd-MM-yyyy'}}</td></tr>
${row("Currency", "{{currency}}")}
<tr><td class="label">Amount (NETT)</td><td class="colon">:</td><td class="value value-price amount-value">{{format_number amount_nett}}</td><td class="extra"></td></tr>
<tr><td class="label">VAT</td><td class="colon">:</td><td class="value value-price amount-value">{{format_number vat}}</td><td class="extra"><span style="display: inline-block; min-width: 150px; text-align: left;">NSFP: {{nsfp}}</span></td></tr>
<tr><td class="label">Total (Include VAT)</td><td class="colon">:</td><td class="value value-price amount-value">{{format_number total}}</td><td class="extra"></td></tr>
${row("PO. No", "{{po_number}}")}
${external ? row("Submitted Legality Docs", "{{legalitas_terkirim}}  {{format_date legalitas_tanggal 'dd-MM-yyyy'}}") + row("NITKU", "{{nitku}}") + [1, 2, 3, 4].map((n) => row("Sub Vendor - " + n, `{{vendor_${n}_nama}} {{vendor_${n}_kontak}}`)).join("\n") : ""}
</table>
<div class="footer-section"><div class="signature-box">
${external ? `<div>Jakarta, ${manualDate}</div><div style="margin-top: 10px;">Received by,</div><br><div class="signature-line"></div><div style="text-align: left; margin-top: 5px;">( {{setting.penerima_nama}} )</div>` : "<br>"}
</div><div class="fm-code">{{setting.kode_form}}</div></div>
${external ? '<div class="voucher-bottom-row"></div><div style="text-align: left; margin-top: 5px; font-weight: bold;">Received Date by FAA : <span style="font-weight: normal;">&emsp;&emsp;&emsp; / &emsp;&emsp;&emsp; / {{tahun}}</span></div>' : ""}
<div class="voucher-bottom-row"></div>
<div class="monitor-box"><div class="monitor-title">MONITOR Information:</div><div class="monitor-info-row">
<div class="monitor-item"><span class="m-label">MSI No.</span><span class="m-value"></span></div>
<div class="monitor-item"><span class="m-label">Created Date</span><span class="m-value">${manualDate}</span></div>
<div class="monitor-item"><span class="m-label">Due Date</span><span class="m-value">${manualDate}</span></div>
<div class="monitor-item"><span class="m-label">Project No.</span><span class="m-value"></span></div>
<div class="monitor-item"><span class="m-label">Amount to Pay</span><span class="m-value">{{currency}} &emsp; </span></div>
<div class="monitor-item"><span class="m-label">WHT Obligation</span><span class="m-value"></span></div></div>
<div class="signature-grid">${["Created", "Approved", "Verified", "Posted"].map((role) => `<div class="sig-column"><div class="sig-role">${role} By:</div><div class="sig-name">( ___________________ )</div></div>`).join("\n")}</div>
<div class="voucher-bottom-row"><div class="v-item"><span class="v-label">Vou No.</span><span class="v-dots">SI - </span></div><div></div><div class="v-item"><span class="v-label">Vou Date</span><span class="v-dots">${manualDate}</span></div><div></div></div>
</div></div></body></html>`;
}
