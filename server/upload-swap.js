import { rename } from "node:fs/promises";

export async function swapUploadFolders(
  staging,
  uploads,
  previous,
  move = rename,
) {
  await move(uploads, previous);
  try {
    await move(staging, uploads);
  } catch (installError) {
    try {
      await move(previous, uploads);
    } catch (rollbackError) {
      throw new AggregateError(
        [installError, rollbackError],
        "Penggantian folder upload dan pemulihannya gagal. Folder asli tetap tersimpan di lokasi sebelum restore; hubungi pengelola server.",
      );
    }
    throw installError;
  }
}
