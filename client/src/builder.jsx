import { RuleEditor } from "./rules";
import { DateRules } from "./date-rules";
import React, { useEffect, useState, useRef } from "react";
import { api, modeClient } from "./api";
import { Busy, Notice, Field } from "./ui";
import { pathFor, validateDefinition, describeRule } from "../../shared/engine";
const types = [
  ["short", "Jawaban singkat"],
  ["long", "Jawaban panjang"],
  ["select", "Pilihan tunggal"],
  ["checkbox", "Multi pilihan"],
  ["date", "Tanggal"],
  ["number", "Angka"],
  ["email", "Email"],
  ["file", "Upload file"],
];
export function FormBuilder({ onError, config }) {
  const { api, download } = modeClient();
  const [data, setData] = useState(null),
    [fields, setFields] = useState([]),
    [sections, setSections] = useState([]),
    [selected, setSelected] = useState(0),
    [tab, setTab] = useState("edit"),
    [answers, setAnswers] = useState({}),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [drag, setDrag] = useState(null),
    [note, setNote] = useState(""),
    [dirty, setDirty] = useState(false),
    [codeUnlocked, setCodeUnlocked] = useState(false);
  const codeInput = useRef(null);
  function load() {
    api("/admin/form")
      .then((d) => {
        setData(d);
        setFields(d.version.fields);
        setSections(d.version.sections);
        setDirty(false);
        setCodeUnlocked(false);
      })
      .catch(onError);
  }
  useEffect(load, []);
  useEffect(() => {
    const handler = (e) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);
  if (!data) return <Busy />;
  const f = fields[selected];
  const update = (patch) => {
    setFields(fields.map((x, i) => (i === selected ? { ...x, ...patch } : x)));
    setDirty(true);
    setMessage("");
  };
  function option(i, patch) {
    update({
      options: f.options.map((o, n) => (i === n ? { ...o, ...patch } : o)),
    });
  }
  function move(from, to) {
    const a = [...fields],
      item = a.splice(from, 1)[0];
    a.splice(to, 0, item);
    setFields(a);
    setSelected(to);
    setCodeUnlocked(false);
    setDirty(true);
  }
  async function save() {
    setBusy(true);
    try {
      validateDefinition(fields, sections);
      const r = await api("/admin/form", {
        method: "PUT",
        body: { fields, sections, baseVersionId: data.version.id, note },
      });
      setData({
        ...data,
        version: r.version,
        versions: [r.version, ...data.versions],
      });
      setDirty(false);
      setCodeUnlocked(false);
      setMessage(
        "Versi form baru disimpan dan aktif. Submission lama tetap memakai versinya.",
      );
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }
  let route;
  try {
    route = pathFor(fields, answers, sections);
  } catch (e) {
    route = { visible: [], end: { message: e.message } };
  }
  return (
    <>
      <Notice type="warning">{data.assumptions}</Notice>
      <Notice>
        Nomor pada daftar mengikuti urutan pertanyaan form aktif. Status
        ketentuan mode ini: {data.termsEnabled === false ? "OFF" : "ON"}.
        {fields.some((f) => f.code === "paham_ketentuan") &&
          " Pertanyaan pemahaman ketentuan mengikuti status Ketentuan dan pengaturan Aktif field."}
      </Notice>
      <Notice type="success">{message}</Notice>
      <div className="builder-toolbar">
        <div className="tabs">
          {[
            ["edit", "Susun form"],
            ["preview", "Pratinjau langsung"],
            ["flow", "Peta alur"],
          ].map(([id, label]) => (
            <button
              key={id}
              className={tab === id ? "active" : ""}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <button disabled={busy} onClick={save}>
          {busy
            ? "Menyimpan…"
            : dirty
              ? "Simpan versi baru ●"
              : "Simpan versi baru"}
        </button>
      </div>
      <div className="filterbar">
        <input
          aria-label="Catatan versi"
          placeholder="Catatan perubahan versi"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <select
          aria-label="Riwayat form"
          value=""
          onChange={async (e) => {
            if (!e.target.value) return;
            try {
              const v = await api("/admin/form/versions/" + e.target.value);
              setFields(v.fields);
              setSections(v.sections);
              setSelected(0);
              setCodeUnlocked(false);
              setDirty(true);
              setMessage(
                "Versi lama dimuat ke editor. Simpan versi baru untuk mengaktifkannya.",
              );
            } catch (e) {
              onError(e);
            }
          }}
        >
          <option value="">Muat riwayat versi…</option>
          {data.versions.map((v, i) => (
            <option key={v.id} value={v.id}>
              Versi {data.versions.length - i} ·{" "}
              {new Date(v.createdAt).toLocaleString("id-ID")}
            </option>
          ))}
        </select>
      </div>
      {tab === "edit" && (
        <div className="builder-grid">
          <aside className="paper field-list">
            <div className="between">
              <h3>Pertanyaan ({fields.length})</h3>
              <button
                className="small"
                onClick={() => {
                  const code = "field_" + Date.now();
                  setFields([
                    ...fields,
                    {
                      code,
                      label: "Pertanyaan baru",
                      type: "short",
                      required: false,
                      active: true,
                      options: [],
                      validation: {},
                      section: sections[0]?.id || "",
                    },
                  ]);
                  setSelected(fields.length);
                  setCodeUnlocked(false);
                  setDirty(true);
                }}
              >
                ＋
              </button>
            </div>
            <small className="muted">
              Seret untuk mengubah urutan, atau gunakan panah.
            </small>
            {fields.map((x, i) => (
              <div
                draggable
                onDragStart={() => setDrag(i)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (drag !== null) move(drag, i);
                  setDrag(null);
                }}
                key={x.code}
                className={
                  "field-list-row " + (selected === i ? "selected" : "")
                }
              >
                <button className="ghost" onClick={() => { setSelected(i); setCodeUnlocked(false); }}>
                  <span className="drag-handle">⠿ {i + 1}.</span>
                  {x.label}
                  <small>
                    {x.code}
                    {x.active === false ? " · Nonaktif" : ""}
                  </small>
                </button>
                <div>
                  <button
                    className="ghost tiny"
                    disabled={!i}
                    aria-label="Naik"
                    onClick={() => move(i, i - 1)}
                  >
                    ↑
                  </button>
                  <button
                    className="ghost tiny"
                    disabled={i === fields.length - 1}
                    aria-label="Turun"
                    onClick={() => move(i, i + 1)}
                  >
                    ↓
                  </button>
                </div>
              </div>
            ))}
            <hr />
            <h3>Section / halaman</h3>
            {sections.map((s, i) => (
              <div key={i} className="section-editor">
                <input
                  aria-label="Nama section"
                  value={s.label}
                  onChange={(e) => {
                    setSections(
                      sections.map((x, n) =>
                        i === n ? { ...x, label: e.target.value } : x,
                      ),
                    );
                    setDirty(true);
                  }}
                />
                <select
                  aria-label="Field pertama section"
                  value={s.firstField}
                  onChange={(e) => {
                    setSections(
                      sections.map((x, n) =>
                        i === n ? { ...x, firstField: e.target.value } : x,
                      ),
                    );
                    setDirty(true);
                  }}
                >
                  {fields.map((f) => (
                    <option key={f.code} value={f.code}>
                      {f.label}
                    </option>
                  ))}
                </select>
                <button
                  className="ghost"
                  onClick={() => {
                    setSections(sections.filter((_, n) => n !== i));
                    setDirty(true);
                  }}
                >
                  Hapus section
                </button>
              </div>
            ))}
            <button
              className="secondary"
              onClick={() => {
                setSections([
                  ...sections,
                  {
                    id: "section_" + Date.now(),
                    label: "Section baru",
                    firstField: fields.at(-1)?.code,
                  },
                ]);
                setDirty(true);
              }}
            >
              ＋ Section
            </button>
          </aside>
          {f && (
            <section className="paper field-settings">
              <div className="between">
                <h2>Pengaturan pertanyaan</h2>
                <span className="small-tag">#{selected + 1}</span>
              </div>
              <div className="field-code-setting">
                <label htmlFor="builder-field-code">Kode field</label>
                <div className="field-code-control">
                  <input id="builder-field-code" ref={codeInput} value={f.code}
                    readOnly={!codeUnlocked || busy} aria-describedby="builder-field-code-help"
                    onChange={(e) => { if (codeUnlocked) update({ code: e.target.value }); }} />
                  <button type="button" className="secondary" disabled={busy}
                    aria-label={codeUnlocked ? "Kunci kode field" : "Buka kunci kode field"}
                    title={codeUnlocked ? "Kunci kode field" : "Buka kunci kode field"}
                    aria-pressed={codeUnlocked} aria-controls="builder-field-code"
                    onClick={() => {
                      setCodeUnlocked(!codeUnlocked);
                      if (!codeUnlocked) requestAnimationFrame(() => codeInput.current?.focus());
                    }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                      <rect x="5" y="10" width="14" height="11" rx="2" />
                      <path d={codeUnlocked ? "M8 10V6a4 4 0 0 1 7.5-2" : "M8 10V6a4 4 0 0 1 8 0v4"} />
                      <path d="M12 14v3" />
                    </svg>
                  </button>
                </div>
                <small id="builder-field-code-help" className="muted">Klik gembok untuk {codeUnlocked ? "mengunci kembali" : "mengubah kode"}. Kode adalah identitas historis. Hindari mengganti kode setelah menerima data.</small>
              </div>
              <label>
                Label
                <textarea
                  value={f.label}
                  onChange={(e) => update({ label: e.target.value })}
                />
              </label>
              <div className="form-grid">
                <label>
                  Tipe
                  <select
                    value={f.type}
                    onChange={(e) =>
                      update({
                        type: e.target.value,
                        ...(["select", "checkbox"].includes(e.target.value) &&
                        !f.options?.length
                          ? { options: [{ value: "Pilihan 1" }] }
                          : {}),
                      })
                    }
                  >
                    {types.map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Section
                  <select
                    value={f.section || ""}
                    onChange={(e) => update({ section: e.target.value })}
                  >
                    <option value="">Tanpa section</option>
                    {sections.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Placeholder
                  <input
                    value={f.placeholder || ""}
                    onChange={(e) => update({ placeholder: e.target.value })}
                  />
                </label>
                <label>
                  Nilai default
                  <input
                    value={
                      Array.isArray(f.defaultValue)
                        ? f.defaultValue.join(",")
                        : (f.defaultValue ?? "")
                    }
                    onChange={(e) =>
                      update({
                        defaultValue:
                          f.type === "checkbox"
                            ? e.target.value.split(",").filter(Boolean)
                            : e.target.value,
                      })
                    }
                  />
                </label>
              </div>
              <label>
                Teks bantuan
                <input
                  value={f.help || ""}
                  onChange={(e) => update({ help: e.target.value })}
                />
              </label>
              <div className="button-row">
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={!!f.required}
                    onChange={(e) => update({ required: e.target.checked })}
                  />
                  Wajib
                </label>
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={f.active !== false}
                    onChange={(e) => update({ active: e.target.checked })}
                  />
                  Aktif
                </label>
              </div>
              <details>
                <summary>Validasi lanjutan</summary>
                {f.type === "date" ? (
                  <DateRules
                    field={f}
                    update={update}
                    timeZone={config?.zona_waktu}
                  />
                ) : (
                  <div className="form-grid">
                    <label>
                      Minimum {f.type === "number" ? "nilai" : "panjang"}
                      <input
                        type="number"
                        value={f.validation?.min ?? ""}
                        onChange={(e) =>
                          update({
                            validation: {
                              ...f.validation,
                              min:
                                e.target.value === ""
                                  ? null
                                  : Number(e.target.value),
                            },
                          })
                        }
                      />
                    </label>
                    <label>
                      Maksimum {f.type === "number" ? "nilai" : "panjang"}
                      <input
                        type="number"
                        value={f.validation?.max ?? ""}
                        onChange={(e) =>
                          update({
                            validation: {
                              ...f.validation,
                              max:
                                e.target.value === ""
                                  ? null
                                  : Number(e.target.value),
                            },
                          })
                        }
                      />
                    </label>
                  </div>
                )}
                <label>
                  Regex
                  <input
                    value={f.validation?.regex || ""}
                    onChange={(e) =>
                      update({
                        validation: { ...f.validation, regex: e.target.value },
                      })
                    }
                  />
                </label>
              </details>
              {["select", "checkbox"].includes(f.type) && (
                <>
                  <hr />
                  <h3>Opsi & percabangan per opsi</h3>
                  {(f.options || []).map((o, i) => (
                    <div className="option-editor" key={i}>
                      <div className="inline">
                        <input
                          aria-label={"Opsi " + (i + 1)}
                          value={o.value}
                          onChange={(e) => option(i, { value: e.target.value })}
                        />
                        <button
                          className="ghost"
                          disabled={!i}
                          onClick={() => {
                            const a = [...f.options];
                            [a[i - 1], a[i]] = [a[i], a[i - 1]];
                            update({ options: a });
                          }}
                        >
                          ↑
                        </button>
                        <button
                          className="ghost"
                          onClick={() =>
                            update({
                              options: f.options.filter((_, n) => n !== i),
                            })
                          }
                        >
                          ✕
                        </button>
                      </div>
                      {f.type === "select" && (
                        <>
                          <select
                            aria-label="Aksi opsi"
                            value={o.action?.type || "next"}
                            onChange={(e) =>
                              option(i, { action: { type: e.target.value } })
                            }
                          >
                            <option value="next">
                              Lanjut pertanyaan berikutnya
                            </option>
                            <option value="jump">
                              Lompat ke pertanyaan / section
                            </option>
                            <option value="end">
                              Akhiri form dengan pesan
                            </option>
                          </select>
                          {o.action?.type === "jump" && (
                            <select
                              aria-label="Tujuan lompatan"
                              value={o.action.target || ""}
                              onChange={(e) =>
                                option(i, {
                                  action: {
                                    ...o.action,
                                    target: e.target.value,
                                  },
                                })
                              }
                            >
                              <option value="">Pilih tujuan…</option>
                              <optgroup label="Pertanyaan berikutnya">
                                {fields.slice(selected + 1).map((x) => (
                                  <option key={x.code} value={x.code}>
                                    {x.label}
                                  </option>
                                ))}
                              </optgroup>
                              <optgroup label="Section">
                                {sections
                                  .filter(
                                    (s) =>
                                      fields.findIndex(
                                        (x) => x.code === s.firstField,
                                      ) > selected,
                                  )
                                  .map((s) => (
                                    <option key={s.id} value={s.id}>
                                      {s.label}
                                    </option>
                                  ))}
                              </optgroup>
                            </select>
                          )}
                          {o.action?.type === "end" && (
                            <>
                              <input
                                aria-label="Pesan penutup"
                                placeholder="Pesan penutup"
                                value={o.action.message || ""}
                                onChange={(e) =>
                                  option(i, {
                                    action: {
                                      ...o.action,
                                      message: e.target.value,
                                    },
                                  })
                                }
                              />
                              <label className="check-label">
                                <input
                                  type="checkbox"
                                  checked={!!o.action.returnToTerms}
                                  onChange={(e) =>
                                    option(i, {
                                      action: {
                                        ...o.action,
                                        returnToTerms: e.target.checked,
                                      },
                                    })
                                  }
                                />
                                Hentikan tanpa submit dan kembali ke ketentuan
                              </label>
                            </>
                          )}
                        </>
                      )}
                    </div>
                  ))}
                  <button
                    className="secondary"
                    onClick={() =>
                      update({
                        options: [...(f.options || []), { value: "Opsi baru" }],
                      })
                    }
                  >
                    ＋ Opsi
                  </button>
                  <details>
                    <summary>Impor opsi dari teks</summary>
                    <textarea
                      id="option-import"
                      placeholder="Satu opsi per baris"
                    />
                    <button
                      className="secondary"
                      onClick={() => {
                        const opts = document
                          .getElementById("option-import")
                          .value.split("\n")
                          .map((v) => v.trim())
                          .filter(Boolean);
                        update({
                          options: [...new Set(opts)].map((value) => ({
                            value,
                          })),
                        });
                      }}
                    >
                      Ganti opsi dari teks
                    </button>
                  </details>
                </>
              )}
              <hr />
              <h3>Tampilkan jika</h3>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={!!f.showIf?.conditions?.length}
                  onChange={(e) =>
                    update({
                      showIf: e.target.checked
                        ? {
                            join: "AND",
                            conditions: [
                              {
                                field: fields[Math.max(0, selected - 1)].code,
                                operator: "eq",
                                value: "",
                              },
                            ],
                          }
                        : null,
                    })
                  }
                />
                Gunakan kondisi
              </label>
              {f.showIf && (
                <RuleEditor
                  rule={f.showIf}
                  fields={fields.slice(0, selected)}
                  onChange={(rule) => update({ showIf: rule })}
                />
              )}
              <hr />
              <button
                className="danger"
                onClick={() => {
                  if (
                    confirm(
                      "Hapus field ini? Field yang sudah memiliki data harus dinonaktifkan.",
                    )
                  ) {
                    setFields(fields.filter((_, i) => i !== selected));
                    setSelected(Math.max(0, selected - 1));
                    setCodeUnlocked(false);
                    setDirty(true);
                  }
                }}
              >
                Hapus field
              </button>
            </section>
          )}
        </div>
      )}
      {tab === "preview" && (
        <section className="paper">
          <h2>Pratinjau jalur form</h2>
          <p className="muted">
            Ubah jawaban untuk menguji pertanyaan yang tampil dan dilewati.
          </p>
          {route.visible.map((f) => (
            <Field
              timeZone={config?.zona_waktu}
              key={f.code}
              field={f}
              value={answers[f.code]}
              onChange={(v) => {
                if (f.type === "file") return;
                setAnswers(
                  pathFor(fields, { ...answers, [f.code]: v }, sections).values,
                );
              }}
            />
          ))}
          {route.end && <Notice type="warning">{route.end.message}</Notice>}
        </section>
      )}
      {tab === "flow" && (
        <section className="paper">
          <h2>Peta alur</h2>
          <p className="muted">
            Alur utama bergerak ke bawah. Cabang hanya boleh menuju pertanyaan
            berikutnya agar tidak terjadi loop.
          </p>
          <div className="flow-map">
            {fields.map((f, i) => (
              <React.Fragment key={f.code}>
                <div
                  className={
                    "flow-node " + (f.active === false ? "disabled" : "")
                  }
                >
                  <span className="eyebrow">
                    {i + 1} · {f.code}
                  </span>
                  <b>{f.label}</b>
                  {f.showIf?.conditions?.length > 0 && (
                    <small>
                      Tampil jika ({f.showIf.join}): {describeRule(f.showIf)}
                    </small>
                  )}
                  {f.options
                    ?.filter((o) => o.action && o.action.type !== "next")
                    .map((o) => (
                      <span className="flow-branch" key={o.value}>
                        {o.value} →{" "}
                        {o.action.type === "end"
                          ? "AKHIR: " + o.action.message
                          : sections.find((s) => s.id === o.action.target)
                              ?.label ||
                            fields.find((x) => x.code === o.action.target)
                              ?.label ||
                            "Tujuan belum dipilih"}
                      </span>
                    ))}
                </div>
                {i < fields.length - 1 && <span className="flow-arrow">↓</span>}
              </React.Fragment>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
