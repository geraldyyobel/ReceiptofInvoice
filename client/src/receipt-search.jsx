import React, { useState } from "react";
import { api, download } from "./api";
import { Notice } from "./ui";

function savedProofs() {
  return ["roi-success-internal", "roi-success-eksternal", "roi-success"].flatMap((key) => {
    try {
      const data = JSON.parse(sessionStorage.getItem(key));
      if (typeof data?.id === "string" && data.id.length <= 64 &&
        typeof data.token === "string" && /^[A-Za-z0-9_-]{43}$/.test(data.token)) {
        return [{ id: data.id, token: data.token }];
      }
    } catch {
      // Email recovery is still available if browser storage is blocked.
    }
    return [];
  });
}

export function ReceiptSearch() {
  const [by, setBy] = useState("reference");
  const [reference, setReference] = useState("");
  const [bookYear, setBookYear] = useState("");
  const [bookNumber, setBookNumber] = useState("");
  const [email, setEmail] = useState("");
  const [searched, setSearched] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  function change(setValue) {
    return (event) => {
      setValue(event.target.value);
      setSearched(null);
      setResult(null);
      setError("");
      setSent(false);
    };
  }

  async function run(action, handler) {
    if (busy) return;
    setBusy(action);
    setError("");
    try {
      await handler();
    } catch (failure) {
      setError(failure instanceof TypeError ? "Server tidak dapat dihubungi. Coba lagi." : failure.message);
    } finally {
      setBusy("");
    }
  }

  function search(event) {
    event.preventDefault();
    const criteria = by === "reference"
      ? { by, reference: reference.trim() }
      : { by, mode: "eksternal", bookYear: Number(bookYear), bookNumber: Number(bookNumber) };
    if (by === "reference" && !criteria.reference) {
      setError("Masukkan nomor referensi.");
      return;
    }
    run("lookup", async () => {
      setSearched(null);
      setResult(null);
      setSent(false);
      const proofs = savedProofs();
      const { found, receipt } = await api("/public/receipts/lookup", {
        method: "POST",
        body: { criteria, proofs },
      });
      if (!found) {
        setError(by === "reference"
          ? "Dokumen tidak ditemukan. Periksa kembali nomor referensi Anda."
          : "Dokumen tidak ditemukan. Periksa kembali nomor buku dan tahun buku Anda.");
        return;
      }
      const proof = proofs.find((entry) => entry.id === receipt?.id);
      if (receipt && proof) setResult({ ...receipt, token: proof.token });
      setSearched(criteria);
    });
  }

  function recover(event) {
    event.preventDefault();
    run("email", async () => {
      setSent(false);
      await api("/public/receipts/email", {
        method: "POST",
        body: { criteria: searched, email },
      });
      setSent(true);
    });
  }

  function downloadReceipt(format) {
    run(format, () => download(
      `/public/submissions/${result.id}/document/${format}`,
      `${result.reference}.${format}`,
      { headers: { "X-Document-Token": result.token } },
    ));
  }

  return (
    <>
      <div className="receipt-search-heading">
        <h1>Cari Receipt of Invoice</h1>
        <p>Temukan bukti penerimaan invoice Eksternal dengan nomor referensi atau nomor buku.</p>
      </div>
      <section className="paper receipt-search" aria-label="Pencarian Receipt of Invoice">
        <form onSubmit={search}>
          <fieldset disabled={Boolean(busy)}>
            <label className="receipt-search-by">
              <span id="receipt-search-by-label">Cari berdasarkan</span>
              <select aria-labelledby="receipt-search-by-label" value={by} onChange={change(setBy)}>
                <option value="reference">Nomor referensi</option>
                <option value="book">Nomor buku</option>
              </select>
            </label>
            {by === "reference" ? (
              <label>
                Nomor referensi
                <input required maxLength={100} autoComplete="off"
                  placeholder="ROI-EKS-2026-000001" value={reference} onChange={change(setReference)} />
              </label>
            ) : (
              <div className="receipt-book-fields">
                <label>
                  Nomor buku
                  <input required inputMode="numeric" pattern="[0-9]{1,10}" maxLength={10}
                    placeholder="Contoh 125" value={bookNumber} onChange={change(setBookNumber)} />
                </label>
                <label>
                  Tahun buku
                  <input required inputMode="numeric" pattern="[0-9]{4}" maxLength={4}
                    placeholder="Contoh 2026" value={bookYear} onChange={change(setBookYear)} />
                </label>
              </div>
            )}
            <button disabled={Boolean(busy)}>
              {busy === "lookup" ? "Mencari…" : "Cari dokumen"}
            </button>
          </fieldset>
        </form>
        {searched && (
          <div className="receipt-search-outcome">
            {result ? (
              <>
                <div aria-live="polite"><h2>Dokumen ditemukan</h2></div>
                <dl className="receipt-metadata">
                  <div><dt>Nomor referensi</dt><dd>{result.reference}</dd></div>
                  <div><dt>Nomor buku</dt><dd>{result.bookNumber ?? "—"}</dd></div>
                  <div><dt>Tahun buku</dt><dd>{result.bookYear ?? "—"}</dd></div>
                  <div><dt>Mode</dt><dd>{result.mode === "internal" ? "Internal" : "Eksternal"}</dd></div>
                </dl>
                <div className="button-row">
                  <button disabled={Boolean(busy)} onClick={() => downloadReceipt("pdf")}>
                    {busy === "pdf" ? "Menyiapkan PDF…" : "Unduh PDF"}
                  </button>
                  <button className="secondary" disabled={Boolean(busy)} onClick={() => downloadReceipt("html")}>
                    {busy === "html" ? "Menyiapkan HTML…" : "HTML siap cetak"}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div aria-live="polite"><h2>Ambil dokumen lewat email</h2></div>
                <p>Masukkan alamat email yang Anda isi saat menyerahkan invoice.</p>
                <form onSubmit={recover}>
                  <label>
                    Email saat penyerahan
                    <input required type="email" autoComplete="email" maxLength={254}
                      disabled={Boolean(busy)} value={email}
                      onChange={(event) => { setEmail(event.target.value); setSent(false); setError(""); }} />
                  </label>
                  <button className="secondary" disabled={Boolean(busy) || sent}>
                    {busy === "email" ? "Memproses…" : "Kirim PDF ke email"}
                  </button>
                </form>
                <Notice>
                  {sent && "Permintaan diterima. Jika nomor dan email cocok, PDF dikirim ke alamat yang tercatat. Periksa juga folder Spam."}
                </Notice>
              </>
            )}
          </div>
        )}
        <Notice type="error">{error}</Notice>
      </section>
      <nav className="receipt-form-links" aria-label="Penyerahan invoice baru">
        <h2>Serahkan invoice baru</h2>
        <div>
          <a href="/internal">Form Internal <span aria-hidden="true">→</span></a>
          <a href="/eksternal">Form Eksternal <span aria-hidden="true">→</span></a>
        </div>
      </nav>
    </>
  );
}
