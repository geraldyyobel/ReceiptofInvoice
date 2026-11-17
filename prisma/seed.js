import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { withInternalEmail } from "./internal-email.js";
import { documentTemplate } from "./document-templates.js";
import {
  initialFields,
  initialTerms,
  initialTemplate,
  defaults,
  assumptions,
} from "./initial.js";
const db = new PrismaClient({
  transactionOptions: { maxWait: 15000, timeout: 60000 },
});
try {
  if (
    !process.env.ADMIN_PASSWORD ||
    process.env.ADMIN_PASSWORD.startsWith("REPLACE_")
  )
    throw Error("Isi ADMIN_PASSWORD atau jalankan npm run setup");
  if (process.env.ADMIN_PASSWORD.length < 12)
    throw Error("Password seed minimal 12 karakter");
  if (Buffer.byteLength(process.env.ADMIN_PASSWORD, "utf8") > 72)
    throw Error(
      "Password seed maksimal 72 byte UTF-8 agar tidak terpotong bcrypt",
    );
  await db.admin.upsert({
    where: { email: process.env.ADMIN_EMAIL || "admin@bcupt.id" },
    update: {},
    create: {
      email: process.env.ADMIN_EMAIL || "admin@bcupt.id",
      name: "Super Admin BCU",
      password: await bcrypt.hash(process.env.ADMIN_PASSWORD, 12),
      role: "superadmin",
    },
  });
  for (const [key, value] of Object.entries(defaults))
    await db.setting.upsert({
      where: { key },
      update: {},
      create: { key, value },
    });
  for (const mode of ["internal", "eksternal"]) {
    await db.mode.upsert({
      where: { id: mode },
      update: {},
      create: {
        id: mode,
        name: mode === "internal" ? "Internal" : "Eksternal",
        reviewRequired: true,
      },
    });
    if (await db.form.findUnique({ where: { mode } })) continue;
    const modeFields =
      mode === "internal" ? withInternalEmail(initialFields) : initialFields;
    await db.$transaction(async (tx) => {
      const t = await tx.termsVersion.create({
        data: { mode, html: initialTerms, author: "seed" },
      });
      await tx.term.create({
        data: { mode, draft: initialTerms, publishedId: t.id },
      });
      const f = await tx.formVersion.create({
        data: {
          mode,
          fields: modeFields,
          sections: [
            {
              id: "utama",
              label: "Informasi tagihan",
              firstField: "paham_ketentuan",
            },
          ],
          note: assumptions,
        },
      });
      await tx.form.create({ data: { mode, currentId: f.id } });
      await tx.formField.createMany({
        data: modeFields.map((definition) => ({
          mode,
          code: definition.code,
          definition,
        })),
      });
      const d = await tx.templateVersion.create({
        data: { mode, html: documentTemplate(mode), author: "seed:provided" },
      });
      await tx.docTemplate.create({ data: { mode, currentId: d.id } });
    });
  }
  console.log(
    "Seed selesai. Akun:",
    process.env.ADMIN_EMAIL || "admin@bcupt.id",
    "• password: ADMIN_PASSWORD di .env",
  );
} finally {
  await db.$disconnect();
}
