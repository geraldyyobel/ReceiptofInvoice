import ExcelJS from "exceljs";
import { setImmediate } from "node:timers/promises";
import { db, audit, fail } from "./core.js";
import { customOptions, customPlan, customRows } from "./custom-query.js";
import { indexCells, spreadsheetSafe } from "../shared/table-data.js";
import { reviewState } from "./custom-review.js";

const batchSize = 500;
async function write(res, text) {
  if (res.destroyed) throw fail("Unduhan dibatalkan", 499);
  if (!res.write(text)) await new Promise((resolve, reject) => {
    const cleanup = () => { res.off("drain", drained); res.off("close", closed); res.off("error", closed); };
    const drained = () => { cleanup(); resolve(); };
    const closed = () => { cleanup(); reject(fail("Unduhan dibatalkan", 499)); };
    res.once("drain", drained); res.once("close", closed); res.once("error", closed);
    if (res.destroyed) closed();
  });
}
const csvLine = (values) => values.map((v) => '"' + String(spreadsheetSafe(v)).replaceAll('"', '""') + '"').join(",") + "\r\n";

export async function exportCustom(req, res, snapshot = null, includeHidden = false) {
  const format = req.params.format;
  if (!["csv", "xlsx"].includes(format)) throw fail("Format tidak didukung");
  const options = customOptions(req.query);
  let count = 0;
  let finishWorkbook;
  const run = async (client) => {
    const plan = snapshot ? null : await customPlan(client, req.mode, options);
    const columns = (snapshot?.columns || plan.columns).filter((c) => includeHidden || !c.hidden);
    const outputColumns = [...columns.map((c) => ({ ...c, key: c.id })),
      { key: "$bookYear", label: "Tahun Buku" }, { key: "$bookNumber", label: "No. Buku" },
      { key: "$reviewChecked", label: "Dicek" }, { key: "$reviewFlag", label: "Penanda" }, { key: "$reviewNote", label: "Catatan" }];
    res.setHeader("Content-Disposition", `attachment; filename="${res.locals.exportFilename || `tabel-kustom-${req.mode}-${plan?.year || "semua-tahun"}.${format}`}"`);
    res.type(format === "csv" ? "text/csv" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    let workbook, sheet;
    if (format === "csv") await write(res, "\uFEFF" + csvLine(outputColumns.map((c) => c.label)));
    else {
      workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: res, useStyles: true, useSharedStrings: false });
      sheet = workbook.addWorksheet("ROI " + req.mode, { views: [{ state: "frozen", ySplit: 1 }] });
      sheet.columns = outputColumns.map((c) => ({ header: c.label, key: c.key, width: 24, hidden: !!c.hidden }));
      const header = sheet.getRow(1);
      header.font = { bold: true, color: { argb: "FFFFFFFF" } };
      header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF18784F" } };
      header.commit();
    }
    const snapshotCells = snapshot ? indexCells(snapshot.cells) : null;
    for (let offset = 0; ; offset += batchSize) {
      if (res.destroyed) throw fail("Unduhan dibatalkan", 499);
      const rows = snapshot ? snapshot.rows.slice(offset, offset + batchSize) : await customRows(client, plan, offset, batchSize);
      if (!rows.length) break;
      const cells = snapshotCells || indexCells(await client.customCell.findMany({
        where: { mode: req.mode, rowId: { in: rows.map((r) => r.id) } },
      }));
      let csv = "";
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i], lookup = cells.get(row.id);
        const review = reviewState(row);
        const values = [...columns.map((c) => lookup?.get(c.id)?.value ?? ""), row.bookYear ?? "", row.bookNumber ?? "",
          review.reviewChecked ? "Ya" : "Tidak", review.reviewFlag === "followup" ? "Tindak lanjut" : review.reviewFlag === "problem" ? "Bermasalah" : "",
          review.reviewNote ?? ""];
        if (format === "csv") csv += csvLine(values);
        else {
          const written = sheet.addRow(values.map(spreadsheetSafe));
          columns.forEach((c, j) => {
            const color = lookup?.get(c.id)?.color || row.color || c.color;
            if (color) written.getCell(j + 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF" + color.slice(1).toUpperCase() } };
          });
          written.commit();
        }
        if (i % 100 === 99) await setImmediate();
      }
      count += rows.length;
      if (format === "csv") await write(res, csv);
      if (rows.length < batchSize) break;
      await setImmediate();
    }
    // Log completion before ending the response, keeping backup drain semantics intact.
    await audit(req, "export." + format, null, { rows: count, year: plan?.year ?? null, review: options.review,
      source: snapshot ? "backup" : "custom" }, req.mode, client);
    if (workbook) { sheet.commit(); finishWorkbook = () => workbook.commit(); }
  };
  try {
    if (snapshot) await run(db);
    else await db.$transaction(run, {
      isolationLevel: (process.env.DATABASE_PROVIDER || "sqlite") === "sqlite" ? "Serializable" : "RepeatableRead",
      timeout: 120000,
    });
    if (finishWorkbook) await finishWorkbook();
    else res.end();
  } catch (error) {
    if (res.headersSent) res.destroy(error);
    else throw error;
  }
}
