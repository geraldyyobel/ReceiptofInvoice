export function fieldsForTerms(fields, enabled) {
  return enabled
    ? fields
    : fields.map((f) =>
        f.code === "paham_ketentuan" ? { ...f, active: false } : f,
      );
}
