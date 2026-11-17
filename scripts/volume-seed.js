import path from "node:path";
import crypto from "node:crypto";
const dir = path.resolve(process.env.DATA_DIR || "");
if (
  process.env.ROI_VOLUME_TEST !== "1" ||
  !dir.startsWith(path.resolve("data", "volume-test-"))
)
  throw Error("Seed volume hanya boleh memakai database uji terpisah");
const { db, settings, hash } = await import("../server/core.js");
const { validateAnswers, amountTotal } = await import("../shared/engine.js");
const count = Number(process.env.ROI_VOLUME_COUNT || 10000),
  started = performance.now();
if (!Number.isInteger(count) || count < 1 || count > 10000)
  throw Error("Jumlah uji harus 1–10000 per mode");
const config = await settings(),
  now = new Date(),
  day = now.toISOString().slice(0, 10),
  results = [];
try {
  for (const mode of ["internal", "eksternal"]) {
    const form = await db.form.findUnique({ where: { mode } }),
      version = await db.formVersion.findUnique({
        where: { id: form.currentId },
      }),
      terms = await db.term.findUnique({ where: { mode } }),
      doc = await db.docTemplate.findUnique({ where: { mode } });
    const definitions = [
      {
        code: "nomor_referensi",
        label: "No. Referensi",
        type: "short",
        options: [],
      },
      ...version.fields,
      { code: "total", label: "Total", type: "number", options: [] },
    ];
    const columns = definitions.map((field, i) => ({
      id: `vol-col-${mode}-${field.code}`,
      mode,
      code: field.code,
      label: field.label,
      type: ["date", "number", "select"].includes(field.type)
        ? field.type
        : "short",
      options: (field.options || []).map((o) => o.value),
      position: i,
      hidden: false,
      color: i % 8 === 0 ? "#dceafb" : null,
    }));
    await db.customColumn.createMany({ data: columns });
    await db.setting.upsert({
      where: { key: "custom_schema_initialized_" + mode },
      create: { key: "custom_schema_initialized_" + mode, value: true },
      update: { value: true },
    });
    let cellsCount = 0,
      valuesCount = 0;
    for (let offset = 0; offset < count; offset += 200) {
      const submissions = [],
        values = [],
        rows = [],
        cells = [];
      for (let i = offset + 1; i <= Math.min(offset + 200, count); i++) {
        const n = String(i).padStart(5, "0"),
          subId = `vol-sub-${mode}-${n}`,
          rowId = `vol-row-${mode}-${n}`,
          vendor = `PT VOLUME ${mode.toUpperCase()} ${n}`;
        const answers = {
          paham_ketentuan: "Ya",
          email_anda:
            mode === "internal"
              ? "annie.la@bcupt.id"
              : `volume-${n}@example.test`,
          received_from: vendor,
          invoice_number: `INV-VOLUME-${mode}-${n}`,
          project_number: `PROJECT-${i % 100}`,
          invoice_date: day,
          currency: "IDR",
          amount_nett: i * 100 + 0.5,
          ada_ppn: i % 3 === 0 ? "Ya" : "Tidak",
          vat: Math.round((i * 100 + 0.5) * 11) / 100,
          nsfp: `NSFP-${n}`,
          invoice_jasa: i % 2 === 0 ? "Ya" : "Tidak",
          nitku: `NITKU-${n}`,
          email_bukpot: `bukpot-${n}@example.test`,
          legalitas_terkirim: i % 2 === 0 ? "Sudah" : "Belum",
          legalitas_tanggal: day,
          permintaan_via: "Email",
          po_number: `PO-${mode}-${n}`,
        };
        const vendorCount = i % 5;
        for (let k = 1; k <= 4; k++) {
          answers["ada_subvendor_" + k] = vendorCount >= k ? "Ya" : "Tidak";
          answers[`vendor_${k}_nama`] = `SUBVENDOR ${k} ${n}`;
          answers[`vendor_${k}_kontak`] = `Kontak Uji ${k} ${n}`;
        }
        const checked = validateAnswers(
          version.fields,
          answers,
          version.sections,
        );
        if (!checked.valid)
          throw Error("Fixture tidak valid: " + JSON.stringify(checked.errors));
        const data = {
            ...checked.values,
            total: amountTotal(checked.values.amount_nett, checked.values.vat),
          },
          timestamp = new Date(now.getTime() - (count - i) * 60000);
        const reference = `ROI-${mode === "internal" ? "INT" : "EKS"}-${now.getFullYear()}-${String(i).padStart(6, "0")}`;
        submissions.push({
          id: subId,
          mode,
          reference,
          tokenHash: hash(crypto.randomUUID()),
          formVersionId: version.id,
          termsVersionId: terms.publishedId,
          templateVersionId: doc.currentId,
          documentSettings: Object.fromEntries(
            [
              "nama_perusahaan",
              "kop",
              "penerima_nama",
              "kode_form",
              "zona_waktu",
              "logo",
            ].map((key) => [key, config[key]]),
          ),
          startedAt: timestamp,
          submittedAt: timestamp,
          vendor,
          email: data.email_anda,
          values: data,
        });
        for (const [code, value] of Object.entries(checked.values))
          values.push({
            id: `vol-val-${mode}-${n}-${code}`,
            submissionId: subId,
            code,
            value,
          });
        rows.push({
          id: rowId,
          mode,
          masterId: subId,
          createdAt: timestamp,
          color: i % 10 === 0 ? "#dff1e5" : null,
        });
        for (const [code, value] of Object.entries({
          nomor_referensi: reference,
          ...data,
        }))
          cells.push({
            id: `vol-cell-${mode}-${n}-${code}`,
            mode,
            rowId,
            columnId: `vol-col-${mode}-${code}`,
            value,
            color: code === "received_from" && i % 10 === 0 ? "#fff0bb" : null,
          });
      }
      await db.$transaction(
        async (tx) => {
          await tx.submission.createMany({ data: submissions });
          await tx.customRow.createMany({ data: rows });
          for (let j = 0; j < values.length; j += 300)
            await tx.submissionValue.createMany({
              data: values.slice(j, j + 300),
            });
          for (let j = 0; j < cells.length; j += 300)
            await tx.customCell.createMany({ data: cells.slice(j, j + 300) });
        },
        { timeout: 120000 },
      );
      valuesCount += values.length;
      cellsCount += cells.length;
      if (offset % 2000 === 0)
        console.log(
          `Fixture ${mode}: ${Math.min(offset + 200, count)}/${count}`,
        );
    }
    await db.counter.upsert({
      where: { key: mode + ":" + now.getFullYear() },
      create: { key: mode + ":" + now.getFullYear(), value: count },
      update: { value: count },
    });
    results.push({
      mode,
      submissions: count,
      customRows: count,
      columns: columns.length,
      cells: cellsCount,
      submissionValues: valuesCount,
    });
  }
  const result = {
    fixtures: results,
    seedMs: Math.round(performance.now() - started),
  };
  console.log(JSON.stringify(result));
  process.send?.(result);
} finally {
  await db.$disconnect();
}
