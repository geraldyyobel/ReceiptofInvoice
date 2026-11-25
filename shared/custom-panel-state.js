export const reviewKeys = ["reviewChecked", "reviewFlag", "reviewNote"];
export const reviewValues = (row) => ({ reviewChecked: !!row.reviewChecked, reviewFlag: row.reviewFlag ?? null, reviewNote: row.reviewNote ?? null });
export const normalizedReview = (key, value) => key === "reviewNote" && !value?.trim() ? null : value;
export const dirtyReview = (state) => reviewKeys.filter((key) => normalizedReview(key, state.draft[key]) !== state.base[key]);
export function panelState(row, cached) {
  if (cached) {
    const cellErrors = { ...cached.cellErrors };
    for (const [id, pending] of Object.entries(cached.cellsSaving || {})) if (pending)
      cellErrors[id] = "Penyimpanan sebelumnya belum terkonfirmasi. Coba lagi.";
    return { ...cached, cellErrors, cellsSaving: {} };
  }
  return { row, base: reviewValues(row), draft: reviewValues(row), cellDrafts: {}, context: 0,
    conflict: null, error: "", unavailable: "", saved: false };
}
export function mergePanelRow(state, row) {
  const next = { ...state, row, base: { ...state.base }, draft: { ...state.draft }, unavailable: "" };
  const dirty = dirtyReview(state), remote = reviewValues(row);
  const conflicts = dirty.filter((key) => remote[key] !== state.base[key]);
  for (const key of reviewKeys) if (!dirty.includes(key)) next.base[key] = next.draft[key] = remote[key];
  if (conflicts.length) next.conflict = { code: "CUSTOM_REVIEW_CONFLICT", current: remote, keys: conflicts };
  if (state.row.bookYear !== row.bookYear) {
    next.context++;
    next.unavailable = "moved";
  }
  return next;
}
export function acceptReviewSave(state, row, sent, context) {
  if (state.context !== context || state.row.bookYear !== row.bookYear) return state;
  const next = { ...state, row: { ...state.row, ...row }, base: { ...state.base }, draft: { ...state.draft }, conflict: null, error: "", saved: true };
  const remote = reviewValues(row), dirty = dirtyReview(state);
  for (const key of reviewKeys) {
    if (Object.hasOwn(sent, key)) {
      next.base[key] = remote[key];
      if (state.draft[key] === sent[key]) next.draft[key] = remote[key];
    } else if (!dirty.includes(key)) next.base[key] = next.draft[key] = remote[key];
  }
  return next;
}
export function displayCell(value) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Ya" : "Tidak";
  return Array.isArray(value) ? value.join("; ") : typeof value === "object" ? JSON.stringify(value) : String(value);
}
export function sameCell(current, original, type) {
  if (type === "number" && current !== "" && original !== "" && original != null)
    return Number.isFinite(Number(current)) && Number(current) === Number(original);
  if (type === "checkbox") return (current === true || current === "true") === (original === true || original === "true");
  return JSON.stringify(current ?? "") === JSON.stringify(original ?? "");
}
