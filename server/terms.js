import { db, fail } from "./core.js";
export const visibilityKey = (mode) => "terms_visibility_" + mode;
export async function termsVisibility(mode, client = db) {
  const setting = await client.setting.findUnique({
    where: { key: visibilityKey(mode) },
  });
  return setting?.value ?? { enabled: true, revision: 0 };
}
export function checkTermsConsent(state, body) {
  if (state.revision !== body.termsRevision)
    throw fail(
      "Status ketentuan berubah. Muat ulang form sebelum mengirim.",
      409,
    );
  if (state.enabled && body.accepted !== true)
    throw fail("Anda harus membaca dan menyetujui ketentuan.", 422);
}
