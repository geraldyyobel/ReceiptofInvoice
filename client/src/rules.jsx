import React from "react";
export function RuleEditor({ rule, fields, onChange, depth = 0 }) {
  const leaf = () => ({
    field: fields.at(-1)?.code || "",
    operator: "eq",
    value: "",
  });
  const edit = (i, value) =>
    onChange({
      ...rule,
      conditions: rule.conditions.map((c, n) => (n === i ? value : c)),
    });
  const remove = (i) =>
    onChange({
      ...rule,
      conditions: rule.conditions.filter((_, n) => n !== i),
    });
  return (
    <fieldset className="rule-group">
      <legend>Grup kondisi {depth + 1}</legend>
      <select
        aria-label="Kombinasi kondisi"
        value={rule.join}
        onChange={(e) => onChange({ ...rule, join: e.target.value })}
      >
        <option value="AND">AND — semua terpenuhi</option>
        <option value="OR">OR — salah satu terpenuhi</option>
      </select>
      {rule.conditions.map((c, i) => (
        <div className="condition-editor" key={i}>
          {c.conditions ? (
            <RuleEditor
              rule={c}
              fields={fields}
              depth={depth + 1}
              onChange={(v) => edit(i, v)}
            />
          ) : (
            <>
              <select
                aria-label="Field pemicu"
                value={c.field}
                onChange={(e) => edit(i, { ...c, field: e.target.value })}
              >
                {fields.map((f) => (
                  <option key={f.code} value={f.code}>
                    {f.label}
                  </option>
                ))}
              </select>
              <select
                aria-label="Operator kondisi"
                value={c.operator}
                onChange={(e) => edit(i, { ...c, operator: e.target.value })}
              >
                {[
                  ["eq", "Sama dengan"],
                  ["neq", "Tidak sama dengan"],
                  ["contains", "Berisi"],
                  ["empty", "Kosong"],
                  ["filled", "Terisi"],
                ].map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
              {!["empty", "filled"].includes(c.operator) && (
                <input
                  aria-label="Nilai kondisi"
                  value={c.value ?? ""}
                  onChange={(e) => edit(i, { ...c, value: e.target.value })}
                />
              )}
            </>
          )}
          <button className="ghost" onClick={() => remove(i)}>
            {c.conditions ? "Hapus grup" : "Hapus kondisi"}
          </button>
        </div>
      ))}
      <div className="button-row">
        <button
          className="secondary small"
          disabled={!fields.length}
          onClick={() =>
            onChange({ ...rule, conditions: [...rule.conditions, leaf()] })
          }
        >
          ＋ Kondisi
        </button>
        <button
          className="secondary small"
          disabled={!fields.length || depth >= 5}
          onClick={() =>
            onChange({
              ...rule,
              conditions: [
                ...rule.conditions,
                {
                  join: rule.join === "AND" ? "OR" : "AND",
                  conditions: [leaf()],
                },
              ],
            })
          }
        >
          ＋ Grup AND/OR
        </button>
      </div>
    </fieldset>
  );
}
