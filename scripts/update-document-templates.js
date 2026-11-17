import { db, cleanHtml, audit } from "../server/core.js";
import { documentTemplate } from "../prisma/document-templates.js";
try {
  for (const mode of ["internal", "eksternal"]) {
    const result = await db.$transaction(async (tx) => {
      const doc = await tx.docTemplate.findUniqueOrThrow({ where: { mode } });
      const previous = await tx.templateVersion.findUniqueOrThrow({
        where: { id: doc.currentId },
      });
      const html = cleanHtml(documentTemplate(mode), true);
      if (html === previous.html) return { mode, unchanged: true };
      const version = await tx.templateVersion.create({
        data: { mode, html, author: "user-provided-template" },
      });
      await tx.docTemplate.update({
        where: { mode },
        data: { currentId: version.id },
      });
      await audit(
        {
          admin: { email: "perubahan atas permintaan pengguna" },
          ip: "lokal",
          mode,
        },
        "template.update",
        previous.html,
        html,
        mode,
        tx,
      );
      return { mode, version: version.id };
    });
    console.log(JSON.stringify(result));
  }
} finally {
  await db.$disconnect();
}
