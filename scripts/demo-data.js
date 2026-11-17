import crypto from "node:crypto";
import { db, settings, hash, audit } from "../server/core.js";
import { validateAnswers, amountTotal } from "../shared/engine.js";
import { dateBounds, todayInZone } from "../shared/date-limits.js";
import { fieldsForTerms } from "../shared/terms.js";
import { termsVisibility } from "../server/terms.js";
import { appendMasterRows } from "../server/custom-sync.js";

const action = process.argv[2] || "add",
  target = 10000,
  key = "demo_data_active_batch";
const actor = {
  ip: "lokal",
  admin: { email: "data uji atas permintaan pengguna" },
};
const pick = (list) => list[crypto.randomInt(list.length)];
function dateValue(field, zone) {
  const today = todayInZone(new Date(), zone),
    bounds = dateBounds(field.validation, { timeZone: zone });
  const max = Date.parse((bounds.max || today) + "T00:00:00Z");
  const min = bounds.min
    ? Date.parse(bounds.min + "T00:00:00Z")
    : max - 150 * 86400000;
  if (min > max) throw Error("Batas tanggal tidak konsisten: " + field.code);
  const days = Math.floor((max - min) / 86400000);
  return new Date(min + crypto.randomInt(days + 1) * 86400000)
    .toISOString()
    .slice(0, 10);
}
function answersFor(fields, mode, i, batch, zone) {
  const suffix = String(i).padStart(5, "0"),
    vendor =
      "[DATA UJI] PT " +
      pick([
        "Cahaya",
        "Nusantara",
        "Prima",
        "Surya",
        "Samudra",
        "Sentosa",
        "Mitra",
        "Jaya",
      ]) +
      " " +
      pick(["Teknik", "Logistik", "Mandiri", "Sejahtera", "Abadi", "Karya"]) +
      " " +
      suffix;
  const currency = pick(["IDR", "USD", "EUR", "SGD"]),
    net =
      currency === "IDR"
        ? crypto.randomInt(10000000, 50000000000) / 100
        : crypto.randomInt(100000, 20000000) / 100;
  const count = crypto.randomInt(5),
    yes = () => (crypto.randomInt(2) ? "Ya" : "Tidak");
  const data = {
    paham_ketentuan: "Ya",
    email_anda: `uji-${mode}-${suffix}@example.test`,
    received_from: vendor,
    invoice_number: `INV-UJI-${batch}-${suffix}`,
    project_number: `PROYEK-UJI-${crypto.randomInt(1, 101)}`,
    currency,
    amount_nett: net,
    ada_ppn: yes(),
    vat: Math.round(net * 11) / 100,
    nsfp: `NSFP-UJI-${suffix}`,
    invoice_jasa: yes(),
    nitku: `NITKU-UJI-${suffix}`,
    email_bukpot: `bukpot-uji-${suffix}@example.test`,
    legalitas_terkirim: crypto.randomInt(2) ? "Sudah" : "Belum",
    permintaan_via: "Email",
    po_number: `PO-UJI-${mode.toUpperCase()}-${crypto.randomInt(10000, 99999)}`,
  };
  for (let k = 1; k <= 4; k++) {
    data["ada_subvendor_" + k] = count >= k ? "Ya" : "Tidak";
    data[`vendor_${k}_nama`] = `[DATA UJI] Subvendor ${k} ${suffix}`;
    data[`vendor_${k}_kontak`] = `KONTAK UJI ${k} ${suffix}`;
  }
  for (const f of fields) {
    if (f.type === "date") {
      data[f.code] = dateValue(f, zone);
      continue;
    }
    if (f.type === "select") {
      const options = f.options.filter((o) => o.action?.type !== "end");
      if (!options.length)
        throw Error("Tidak ada opsi aman untuk fixture: " + f.code);
      if (!options.some((o) => o.value === data[f.code]))
        data[f.code] = pick(options).value;
    } else if (data[f.code] === undefined) {
      if (f.type === "checkbox")
        data[f.code] = f.options.length ? [pick(f.options).value] : [];
      else if (f.type === "number")
        data[f.code] = Math.max(1, f.validation?.min || 1);
      else if (f.type === "email") data[f.code] = `uji-${suffix}@example.test`;
      else if (f.type === "file") {
        if (f.required && f.active !== false)
          throw Error("Upload wajib perlu fixture file khusus: " + f.code);
      } else data[f.code] = `DATA UJI ${suffix}`;
    }
  }
  return data;
}
try {
  if ((process.env.DATABASE_PROVIDER || "sqlite") !== "postgresql")
    throw Error("Script data uji ini hanya diizinkan pada PostgreSQL proyek.");
  const config = await settings();
  let state = (await db.setting.findUnique({ where: { key } }))?.value;
  if (action === "add") {
    if (state?.status === "removed")
      throw Error(
        "Batch lama telah dibersihkan. Untuk batch baru, tinjau pengaturan demo_data_active_batch terlebih dahulu.",
      );
    if (!state) {
      state = {
        batch:
          "PG" +
          new Date().toISOString().slice(0, 10).replaceAll("-", "") +
          "-" +
          crypto.randomBytes(3).toString("hex"),
        status: "running",
        createdAt: new Date().toISOString(),
        targetPerMode: target,
        counts: { internal: 0, eksternal: 0 },
        before: {},
      };
      for (const mode of ["internal", "eksternal"])
        state.before[mode] = {
          master: await db.submission.count({ where: { mode } }),
          custom: await db.customRow.count({ where: { mode } }),
        };
      await db.setting.create({ data: { key, value: state } });
    }
    for (const mode of ["internal", "eksternal"]) {
      const current = await db.form.findUnique({ where: { mode } }),
        version = await db.formVersion.findUnique({
          where: { id: current.currentId },
        }),
        term = await db.term.findUnique({ where: { mode } }),
        template = await db.docTemplate.findUnique({ where: { mode } }),
        visibility = await termsVisibility(mode);
      const fields = fieldsForTerms(version.fields, visibility.enabled),
        prefix = `demo-${state.batch}-${mode}-`;
      const existing = await db.submission.count({
        where: { mode, id: { startsWith: prefix } },
      });
      if (existing !== state.counts[mode])
        throw Error("Jumlah data uji tidak konsisten dengan manifest: " + mode);
      for (let offset = existing; offset < target; offset += 200) {
        const submissions = [],
          values = [];
        for (let i = offset + 1; i <= Math.min(offset + 200, target); i++) {
          const raw = answersFor(
              fields,
              mode,
              i,
              state.batch,
              config.zona_waktu,
            ),
            v = validateAnswers(fields, raw, version.sections, {
              timeZone: config.zona_waktu,
            });
          if (!v.valid)
            throw Error(
              "Fixture tidak sesuai form " +
                mode +
                ": " +
                JSON.stringify(v.errors),
            );
          const id = prefix + String(i).padStart(5, "0"),
            submittedAt = new Date(
              Date.now() - crypto.randomInt(0, 10000) * 1000,
            );
          const documentSettings = Object.fromEntries(
            [
              "nama_perusahaan",
              "kop",
              "penerima_nama",
              "kode_form",
              "zona_waktu",
              "logo",
            ].map((k) => [k, config[k]]),
          );
          submissions.push({
            id,
            mode,
            reference: `UJI-${mode === "internal" ? "INT" : "EKS"}-${state.batch}-${String(i).padStart(5, "0")}`,
            tokenHash: hash(crypto.randomUUID()),
            formVersionId: version.id,
            termsVersionId: term.publishedId,
            templateVersionId: template.currentId,
            documentSettings: {
              ...documentSettings,
              termsEnabled: visibility.enabled,
              termsAccepted: visibility.enabled,
              termsRevision: visibility.revision,
            },
            startedAt: new Date(submittedAt.getTime() - 300000),
            submittedAt,
            vendor: String(v.values.received_from || "[DATA UJI]"),
            email: String(v.values.email_anda || ""),
            values: {
              ...v.values,
              total: amountTotal(v.values.amount_nett, v.values.vat),
            },
          });
          for (const [code, value] of Object.entries(v.values))
            values.push({ submissionId: id, code, value });
        }
        await db.$transaction(
          async (tx) => {
            if (
              (await tx.form.findUnique({ where: { mode } })).currentId !==
              version.id
            )
              throw Error(
                "Form berubah saat seed; hentikan dan tinjau kembali.",
              );
            await tx.submission.createMany({ data: submissions });
            for (let j = 0; j < values.length; j += 300)
              await tx.submissionValue.createMany({
                data: values.slice(j, j + 300),
              });
            const synced = await appendMasterRows(tx, mode, submissions);
            if (synced.added !== submissions.length)
              throw Error("Salinan kustom tidak lengkap");
            state.counts[mode] = offset + submissions.length;
            await tx.setting.update({ where: { key }, data: { value: state } });
          },
          { timeout: 120000 },
        );
        if (state.counts[mode] % 2000 === 0)
          console.log(`${mode}: ${state.counts[mode]}/${target} data uji`);
      }
    }
    state.status = "complete";
    state.completedAt = new Date().toISOString();
    await db.setting.update({ where: { key }, data: { value: state } });
    await audit(
      actor,
      "demo.seed",
      null,
      { batch: state.batch, counts: state.counts },
      null,
    );
    console.log(
      JSON.stringify({
        status: "complete",
        batch: state.batch,
        addedPerMode: state.counts,
        numberingUnchanged: true,
      }),
    );
  } else if (action === "remove") {
    if (!state || state.status === "removed")
      throw Error("Tidak ada batch data uji aktif.");
    if (!process.argv.includes("--confirm=HAPUS-DATA-UJI"))
      throw Error(
        "Konfirmasi wajib: node scripts/demo-data.js remove --confirm=HAPUS-DATA-UJI",
      );
    await db.$transaction(
      async (tx) => {
        for (const mode of ["internal", "eksternal"]) {
          const prefix = `demo-${state.batch}-${mode}-`;
          const rows = await tx.submission.findMany({
            where: { mode, id: { startsWith: prefix } },
            select: { id: true, reference: true, vendor: true },
          });
          if (
            rows.some(
              (r) =>
                !r.reference.startsWith("UJI-") ||
                !r.vendor.startsWith("[DATA UJI]"),
            )
          )
            throw Error(
              "Penanda data uji tidak sesuai; penghapusan dibatalkan.",
            );
          const ids = rows.map((r) => r.id),
            custom = await tx.customRow.findMany({
              where: { mode, masterId: { in: ids } },
              select: { id: true },
            }),
            customIds = custom.map((r) => r.id);
          for (const history of await tx.customHistory.findMany({
            where: { mode },
          })) {
            const text = JSON.stringify([history.undo, history.redo]);
            if (
              text.includes(prefix) ||
              customIds.some((id) => text.includes(id))
            )
              await tx.customHistory.delete({ where: { id: history.id } });
          }
          await tx.customCell.deleteMany({
            where: { mode, rowId: { in: customIds } },
          });
          await tx.customRow.deleteMany({
            where: { mode, id: { in: customIds } },
          });
          await tx.submissionValue.deleteMany({
            where: { submissionId: { in: ids } },
          });
          await tx.submission.deleteMany({ where: { mode, id: { in: ids } } });
        }
        state.status = "removed";
        state.removedAt = new Date().toISOString();
        await tx.setting.update({ where: { key }, data: { value: state } });
        await audit(
          actor,
          "demo.remove",
          null,
          { batch: state.batch },
          null,
          tx,
        );
      },
      { timeout: 180000 },
    );
    console.log(
      "Batch data uji dihapus; data lain dan susunan kolom tetap disimpan.",
    );
  } else throw Error("Aksi tidak dikenal. Gunakan add atau remove.");
} finally {
  await db.$disconnect();
}
