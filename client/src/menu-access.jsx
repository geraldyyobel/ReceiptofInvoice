import React, { useState } from "react";
import { masterReaderRole, workspaceMenus } from "../../shared/admin-routing";
import { api } from "./api";
import { Busy, Modal, Notice } from "./ui";

export const accessPath = "/admin/settings/menu-access";

export function MenuAccessSettings({ accounts, policy, setPolicy, refreshAccess }) {
  const [scope, setScope] = useState("roles");
  const [role, setRole] = useState("admin");
  const [accountId, setAccountId] = useState("");
  const [adding, setAdding] = useState(false);
  const account = accounts.find(({ id }) => id === accountId) || accounts[0];
  const byRole = scope === "roles";
  const targetId = byRole ? role : account?.id;
  const targetRole = byRole ? role : account?.role;

  async function save(rules) {
    const result = await api(accessPath + "/" + scope + "/" + encodeURIComponent(targetId), {
      method: "PUT",
      body: byRole ? { menus: rules } : { overrides: rules },
    });
    setPolicy((previous) => ({
      ...previous,
      [scope]: { ...previous[scope], [targetId]: result.rules },
    }));
    await refreshAccess();
  }

  if (!policy) return <Busy />;
  const locked = targetRole === masterReaderRole;
  return (
    <div className="menu-access">
      <p>Atur menu yang dapat dibuka di ruang kerja Internal dan Eksternal.</p>
      <div className="button-row" role="group" aria-label="Jenis aturan akses">
        <button type="button" className={byRole ? "" : "secondary"} aria-pressed={byRole}
          onClick={() => setScope("roles")}>Berdasarkan role</button>
        <button type="button" className={byRole ? "secondary" : ""} aria-pressed={!byRole}
          onClick={() => setScope("accounts")}>Berdasarkan akun</button>
        <button type="button" className="secondary" onClick={() => setAdding(true)}>＋ Tambah role</button>
      </div>
      {byRole ? (
        <label>
          Role
          <select aria-label="Role yang diatur" value={role} onChange={(e) => setRole(e.target.value)}>
            {Object.entries(policy.roleLabels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
        </label>
      ) : (
        <label>
          Akun admin
          <select aria-label="Akun yang diatur" value={targetId || ""} onChange={(e) => setAccountId(e.target.value)}>
            {!accounts.length && <option value="">Belum ada akun</option>}
            {accounts.map(({ id, name, email, active }) => (
              <option value={id} key={id}>{name} ({email}){active ? "" : " · Nonaktif"}</option>
            ))}
          </select>
        </label>
      )}
      {targetId && (
        <MenuRules key={scope + ":" + targetId + ":" + targetRole} byRole={byRole}
          roleLabel={policy.roleLabels[targetRole] || targetRole} locked={locked}
          defaults={policy.roles[targetRole] || []} overrides={locked ? {} : policy.accounts[targetId] || {}}
          onSave={save} />
      )}
      {adding && <CreateRole onClose={() => setAdding(false)} onCreate={({ id, label, menus }) => {
        setPolicy((previous) => ({
          ...previous,
          roles: { ...previous.roles, [id]: menus },
          roleLabels: { ...previous.roleLabels, [id]: label },
        }));
        setScope("roles");
        setRole(id);
        setAdding(false);
      }} />}
    </div>
  );
}

function CreateRole({ onClose, onCreate }) {
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Modal title="Tambah role" onClose={() => { if (!busy) onClose(); }}>
      <form onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setError("");
        try {
          onCreate(await api(accessPath + "/roles", { method: "POST", body: { label } }));
        } catch (failure) {
          setError(failure.status === 409 ? "Nama role sudah digunakan." : failure.message);
        } finally {
          setBusy(false);
        }
      }}>
        <label>Nama role<input required minLength={2} maxLength={50}
          disabled={busy} value={label} onChange={(e) => setLabel(e.target.value)} /></label>
        <Notice type="error">{error}</Notice>
        <button disabled={busy}>Buat role</button>
      </form>
    </Modal>
  );
}

function MenuRules({ byRole, roleLabel, locked, defaults, overrides, onSave }) {
  const [rules, setRules] = useState(() => byRole ? defaults : overrides);
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");

  function update(id, value) {
    setSuccess(false);
    if (byRole) {
      setRules((previous) => value ? [...previous, id] : previous.filter((menu) => menu !== id));
    } else {
      setRules((previous) => {
        const next = { ...previous };
        if (value === "inherit") delete next[id];
        else next[id] = value === "allow";
        return next;
      });
    }
  }

  return (
    <form onSubmit={async (event) => {
      event.preventDefault();
      if (locked) return;
      setBusy(true);
      setSuccess(false);
      setError("");
      try {
        await onSave(rules);
        setSuccess(true);
      } catch (e) {
        setError(e.message);
      } finally {
        setBusy(false);
      }
    }}>
      {locked ? (
        <p className="muted">Role User hanya dapat melihat daftar dan detail Data Form Master. Ubah role akun untuk memberikan akses lain.</p>
      ) : byRole ? (
        <p className="muted">Pilihan ini menjadi bawaan bagi semua akun dengan role {roleLabel}.</p>
      ) : (
        <p className="muted">Role akun: {roleLabel}. Pilih “Ikuti role” untuk memakai izin bawaan. Pilihan lain berlaku khusus untuk akun ini.</p>
      )}
      <fieldset disabled={busy || locked} className="menu-access-rules">
        <legend>Izin buka menu</legend>
        {workspaceMenus.map(([id, , label]) => byRole ? (
          <label key={id} className="check-label">
            <input type="checkbox" checked={rules.includes(id)} onChange={(e) => update(id, e.target.checked)} />
            {label}
          </label>
        ) : (
          <label key={id} className="menu-access-override">
            <span>{label}</span>
            <select aria-label={label} value={rules[id] === undefined ? "inherit" : rules[id] ? "allow" : "deny"}
              onChange={(e) => update(id, e.target.value)}>
              <option value="inherit">Ikuti role ({defaults.includes(id) ? "diizinkan" : "diblokir"})</option>
              <option value="allow">Izinkan</option>
              <option value="deny">Blokir</option>
            </select>
          </label>
        ))}
        <p className="menu-access-fixed"><strong>Settings</strong> <span>Khusus Super Admin</span></p>
      </fieldset>
      {!locked && <button disabled={busy}>{busy ? "Menyimpan…" : "Simpan akses menu"}</button>}
      <Notice type="success">{success && "Aturan akses menu disimpan."}</Notice>
      <Notice type="error">{error}</Notice>
    </form>
  );
}
