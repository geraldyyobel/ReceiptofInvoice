import crypto from "node:crypto";
import { submissionBook } from "./bookkeeping.js";
export const schemaKey = (mode) => "custom_schema_initialized_" + mode;
// Append only. Existing rows, cells, column metadata and views are never updated.
export async function appendMasterRows(tx, mode, submissions) {
  const [existingRows, columns, initialized] = await Promise.all([
    tx.customRow.findMany({ where: { mode, masterId: { in: submissions.map((s) => s.id) } }, select: { masterId: true } }),
    tx.customColumn.findMany({ where: { mode }, orderBy: { position: "asc" } }),
    tx.setting.findUnique({ where: { key: schemaKey(mode) } }),
  ]);
  const existing = new Set(existingRows.map((r) => r.masterId)),
    seen = new Set();
  const pending = submissions.filter(
    (s) =>
      s.mode === mode &&
      !existing.has(s.id) &&
      !seen.has(s.id) &&
      seen.add(s.id),
  );
  const map = new Map(columns.map((c) => [c.code, c]));
  // Initialize a fresh workspace only; deleting/renaming/hiding columns remains respected.
  if (
    !initialized &&
    !columns.length &&
    !(await tx.customRow.count({ where: { mode } })) &&
    pending.length
  ) {
    const defs = new Map(
      (await tx.formField.findMany({ where: { mode } })).map((f) => [
        f.code,
        f.definition,
      ]),
    );
    const fresh = [];
    const source = {
      nomor_referensi: "",
      ...Object.fromEntries(
        [...defs]
          .filter(([, def]) => def.active !== false)
          .map(([code]) => [code, ""]),
      ),
      ...Object.assign({}, ...pending.map((sub) => sub.values)),
    };
    for (const [code, value] of Object.entries(source)) {
      if (map.has(code)) continue;
      const def = defs.get(code),
        type = ["number", "date", "select"].includes(def?.type)
          ? def.type
          : typeof value === "number"
            ? "number"
            : "short";
      const c = {
        id: crypto.randomUUID(),
        mode,
        code,
        label:
          code === "nomor_referensi" ? "No. Referensi" : def?.label || code,
        type,
        position: fresh.length,
        options: type === "select" ? def.options.map((o) => o.value) : [],
      };
      map.set(code, c);
      fresh.push(c);
    }
    if (fresh.length) await tx.customColumn.createMany({ data: fresh });
  }
  if (!initialized && (columns.length || existingRows.length || pending.length))
    await tx.setting.upsert({
      where: { key: schemaKey(mode) },
      create: { key: schemaKey(mode), value: true },
      update: { value: true },
    });
  const rows = [],
    cells = [];
  for (const sub of pending) {
    const book = await submissionBook(tx, sub);
    const row = { id: crypto.randomUUID(), mode, masterId: sub.id, ...book };
    // A custom invoice date may have moved an older row to this book number.
    if (await tx.customRow.findFirst({ where: { mode, bookYear: book.bookYear, bookNumber: book.bookNumber } })) {
      const { nextBookNumber } = await import("./bookkeeping.js");
      Object.assign(row, await nextBookNumber(tx, mode, book.bookYear));
    }
    rows.push(row);
    for (const [code, value] of Object.entries({
      nomor_referensi: sub.reference,
      ...sub.values,
    })) {
      if (map.has(code))
        cells.push({ mode, rowId: row.id, columnId: map.get(code).id, value });
    }
  }
  for (let i = 0; i < rows.length; i += 300)
    await tx.customRow.createMany({ data: rows.slice(i, i + 300) });
  for (let i = 0; i < cells.length; i += 300)
    await tx.customCell.createMany({ data: cells.slice(i, i + 300) });
  return { added: rows.length };
}
