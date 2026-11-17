export function indexCells(cells) {
  const rows = new Map();
  for (const cell of cells) {
    if (!rows.has(cell.rowId)) rows.set(cell.rowId, new Map());
    rows.get(cell.rowId).set(cell.columnId, cell);
  }
  return rows;
}
export function spreadsheetSafe(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "number" || typeof value === "boolean") return value;
  const text = Array.isArray(value) ? value.join("; ") : String(value);
  return /^[=+\-@\t\r]/.test(text) ? "'" + text : text;
}
