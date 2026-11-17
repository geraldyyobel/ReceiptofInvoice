import React, { useState, useEffect } from "react";
import { api, date } from "./api";
import { Notice, Busy } from "./ui";
export function MailAccounts({
  method,
  onMethodChange,
  onConnectedSender,
  onRefresh,
  onError,
}) {
  const [providers, setProviders] = useState(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  async function load() {
    const d = await api("/admin/mail/status");
    setProviders(d.providers);
    return d.providers;
  }
  useEffect(() => {
    load().catch(onError);
    const outcome = new URLSearchParams(location.search).get("mail_oauth");
    if (outcome) {
      setMessage(
        outcome === "success"
          ? "Akun email berhasil dihubungkan. Metode pengiriman sudah diaktifkan."
          : outcome === "denied"
            ? "Login email dibatalkan."
            : "Login email gagal atau kedaluwarsa. Periksa konfigurasi lalu coba kembali.",
      );
      history.replaceState(null, "", location.pathname);
    }
  }, []);
  if (!providers) return <Busy>Memuat koneksi email…</Busy>;
  return (
    <section className="mail-accounts">
      <h3>Akun pengirim email</h3>
      <p className="muted">
        Hubungkan akun untuk mengirim dokumen ROI. Ini tidak mengubah akun login
        admin. Pengirim mengikuti alamat akun yang terhubung.
      </p>
      <Notice>{message}</Notice>
      <label>
        Metode pengiriman
        <select
          aria-label="Metode pengiriman email"
          value={method || "smtp"}
          onChange={(e) => {
            const next = e.target.value;
            onMethodChange(next);
            if (providers[next]?.email)
              onConnectedSender(providers[next].email);
          }}
        >
          <option value="smtp">SMTP manual</option>
          <option
            value="outlook"
            disabled={
              !providers.outlook.connected || providers.outlook.needsReconnect
            }
          >
            Outlook / Microsoft 365
          </option>
          <option
            value="gmail"
            disabled={
              !providers.gmail.connected || providers.gmail.needsReconnect
            }
          >
            Gmail / Google Workspace
          </option>
          <option value="none">Tidak aktif</option>
        </select>
      </label>
      <div className="mail-provider-grid">
        {[
          ["outlook", "Outlook / Microsoft 365"],
          ["gmail", "Gmail / Google Workspace"],
        ].map(([provider, label]) => {
          const p = providers[provider];
          return (
            <div className="mail-provider" key={provider}>
              <h3>{label}</h3>
              <span className={"status " + (p.needsReconnect ? "failed" : "")}>
                {p.needsReconnect
                  ? "Perlu login ulang"
                  : p.connected
                    ? "Terhubung"
                    : "Belum terhubung"}
              </span>
              {p.email && (
                <p>
                  <strong>{p.email}</strong>
                  <small>Terhubung sejak {date(p.connectedAt)}</small>
                </p>
              )}
              {!p.configured && (
                <p className="muted">
                  Perlu pengaturan OAuth oleh pengelola server.
                </p>
              )}
              <div className="button-row">
                <button
                  type="button"
                  className="secondary"
                  disabled={busy || !p.configured}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      const r = await api(
                        "/admin/mail/oauth/" + provider + "/start",
                        { method: "POST", body: {} },
                      );
                      location.assign(r.url);
                    } catch (e) {
                      onError(e);
                      setBusy(false);
                    }
                  }}
                >
                  {p.connected
                    ? "Hubungkan ulang"
                    : "Login " + (provider === "gmail" ? "Gmail" : "Outlook")}
                </button>
                {p.connected && (
                  <button
                    type="button"
                    className="danger small"
                    disabled={busy}
                    onClick={async () => {
                      if (
                        !confirm(
                          "Putuskan koneksi " +
                            label +
                            "? Jika metode ini sedang dipakai, pengiriman email akan dinonaktifkan.",
                        )
                      )
                        return;
                      setBusy(true);
                      try {
                        await api("/admin/mail/oauth/" + provider, {
                          method: "DELETE",
                        });
                        await load();
                        await onRefresh();
                        setMessage(
                          "Koneksi diputus. Izin pada Microsoft/Google dapat dicabut juga melalui pengaturan akun penyedia.",
                        );
                      } catch (e) {
                        onError(e);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Putuskan koneksi
                  </button>
                )}
              </div>
              <details>
                <summary>Konfigurasi awal</summary>
                <p className="muted">
                  {p.configurationError ||
                    "Daftarkan aplikasi OAuth, isi kredensial pada server, lalu gunakan alamat callback berikut."}
                </p>
                {p.redirectUri && (
                  <code className="callback-url">{p.redirectUri}</code>
                )}
                {p.missing?.length > 0 && (
                  <small>
                    Belum diisi: {p.missing.join(", ")}. Petunjuk ada di panduan
                    OAuth proyek.
                  </small>
                )}
              </details>
            </div>
          );
        })}
      </div>
      <p className="muted">
        Setelah memilih metode, klik Simpan pengaturan lalu Tes kirim email.
        Login yang berhasil otomatis memilih akun tersebut. Jika Google menolak
        browser tertanam, buka aplikasi di Chrome atau Edge.
      </p>
    </section>
  );
}
