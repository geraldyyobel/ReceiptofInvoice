import { validateDefinition } from "../shared/engine.js";
import { termsVisibility } from "./terms.js";
import { audit } from "./core.js";

export async function removeHiddenConsent(client, mode, req) {
  return client.$transaction(async (tx) => {
    const current = await tx.form.findUnique({ where: { mode } });
    const old = await tx.formVersion.findUnique({
      where: { id: current.currentId },
    });
    const question = old.fields.find((f) => f.code === "paham_ketentuan");
    if (!question)
      return { mode, removed: false, reason: "Sudah tidak ada di form aktif" };
    const visibility = await termsVisibility(mode, tx);
    if (visibility.enabled && question.active !== false)
      return { mode, removed: false, reason: "Masih tampil pada form publik" };
    const fields = old.fields.filter((f) => f.code !== question.code);
    const next = fields.find((f) => f.active !== false)?.code;
    const sections = old.sections.map((s) =>
      s.firstField !== question.code
        ? s
        : {
            ...s,
            firstField:
              fields.find((f) => f.section === s.id && f.active !== false)
                ?.code || next,
          },
    );
    // Reject dangling branching references rather than guessing new logic.
    validateDefinition(fields, sections);
    const version = await tx.formVersion.create({
      data: {
        mode,
        fields,
        sections,
        note: "Menghapus pertanyaan pemahaman ketentuan yang tersembunyi dari form aktif; riwayat tetap tersimpan.",
      },
    });
    await tx.form.update({ where: { mode }, data: { currentId: version.id } });
    // Retain historical definitions and answers. The current version no longer
    // includes this question, so the builder and public form both omit it.
    await tx.formField.updateMany({
      where: { mode, code: question.code },
      data: { definition: { ...question, active: false } },
    });
    await audit(
      req,
      "form.remove_hidden_consent",
      { versionId: old.id, code: question.code },
      { versionId: version.id },
      mode,
      tx,
    );
    return { mode, removed: true, versionId: version.id };
  });
}
