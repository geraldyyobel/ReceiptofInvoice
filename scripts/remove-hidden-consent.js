import { db } from "../server/core.js";
import { createBackup } from "../server/backup.js";
import { removeHiddenConsent } from "../server/remove-hidden-consent.js";
const req = {
  ip: "lokal",
  admin: { email: "pembaruan atas permintaan pengguna" },
};
try {
  const safety = await createBackup(req);
  console.log("Backup pengaman: " + safety.filename);
  for (const mode of ["internal", "eksternal"])
    console.log(JSON.stringify(await removeHiddenConsent(db, mode, req)));
} finally {
  await db.$disconnect();
}
