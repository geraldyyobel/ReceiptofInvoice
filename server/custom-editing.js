import crypto from "node:crypto";
import { z } from "zod";
import { validDate } from "../shared/date-limits.js";
import { db, fail, settings, inTimezone } from "./core.js";
import { nextBookNumber, invoiceYear } from "./bookkeeping.js";
import { reviewFields, reviewKeys, reviewConflict } from "./custom-review.js";
import {
  customHistoryStatus,
  mutateCustom,
  navigateCustomHistory,
} from "./custom-history.js";
const color = z
  .string()
  .regex(/^#[a-fA-F\d]{6}$/)
  .nullable();
export function registerCustomEditingRoutes(app) {
  app.get("/api/admin/custom/rows/:id", async (req, res) => {
    const result = await db.$transaction(async (tx) => {
      const row = await tx.customRow.findFirst({ where: { id: req.params.id, mode: req.mode } });
      if (!row) throw fail("Baris tabel kustom tidak lagi tersedia dalam mode ini", 404);
      const cells = await tx.customCell.findMany({ where: { rowId: row.id, mode: req.mode } });
      return { row, cells };
    }, { isolationLevel: (process.env.DATABASE_PROVIDER || "sqlite") === "sqlite" ? "Serializable" : "RepeatableRead" });
    res.json(result);
  });
  app.get("/api/admin/custom/history", async (req, res) =>
    res.json(await customHistoryStatus(db, req)),
  );
  for (const direction of ["undo", "redo"])
    app.post("/api/admin/custom/" + direction, async (req, res) => {
      const { expectedId } = z
        .object({ expectedId: z.string().min(1) })
        .parse(req.body);
      res.json(await navigateCustomHistory(req, direction, expectedId));
    });
  app.post("/api/admin/custom/columns", async (req, res) => {
    const b = z
      .object({
        label: z.string().min(1).max(200),
        type: z.enum(["short", "number", "date", "select", "checkbox"]),
        options: z.array(z.string()).default([]),
      })
      .parse(req.body);
    res.json(
      await mutateCustom(
        req,
        "Tambah kolom",
        "custom.column.create",
        async (w) =>
          w.add("customColumn", {
            ...b,
            code: "custom_" + crypto.randomBytes(6).toString("hex"),
            position:
              ((
                await w.tx.customColumn.aggregate({
                  where: { mode: req.mode },
                  _max: { position: true },
                })
              )._max.position ?? -1) + 1,
          }),
      ),
    );
  });
  app.post("/api/admin/custom/columns/order", async (req, res) => {
    const { ids } = z
      .object({ ids: z.array(z.string()).max(2000) })
      .parse(req.body);
    await mutateCustom(
      req,
      "Urutkan kolom",
      "custom.column.order",
      async (w) => {
        const current = await w.tx.customColumn.findMany({
          where: { mode: req.mode },
        });
        if (
          new Set(ids).size !== ids.length ||
          ids.length !== current.length ||
          current.some((c) => !ids.includes(c.id))
        )
          throw fail("Daftar kolom berubah. Muat ulang tabel.", 409);
        for (let i = 0; i < ids.length; i++)
          await w.patch("customColumn", ids[i], { position: i });
      },
    );
    res.json({ ok: true });
  });
  app.post("/api/admin/custom/columns/visibility", async (req, res) => {
    const { visible } = z
      .object({ visible: z.array(z.string()).max(2000) })
      .parse(req.body);
    await mutateCustom(
      req,
      "Terapkan visibilitas view",
      "custom.column.visibility",
      async (w) => {
        const cols = await w.tx.customColumn.findMany({
          where: { mode: req.mode },
        });
        if (visible.some((id) => !cols.some((c) => c.id === id)))
          throw fail("Kolom view sudah berubah. Muat ulang tabel.", 409);
        for (const c of cols)
          await w.patch("customColumn", c.id, {
            hidden: !visible.includes(c.id),
          });
      },
    );
    res.json({ ok: true });
  });
  app.patch("/api/admin/custom/columns/:id", async (req, res) => {
    const b = z
      .object({
        label: z.string().min(1).max(200).optional(),
        position: z.number().int().min(0).optional(),
        hidden: z.boolean().optional(),
        color: color.optional(),
        options: z.array(z.string()).optional(),
      })
      .parse(req.body);
    res.json(
      await mutateCustom(req, "Ubah kolom", "custom.column.update", (w) =>
        w.patch("customColumn", req.params.id, b),
      ),
    );
  });
  app.delete("/api/admin/custom/columns/:id", async (req, res) => {
    await mutateCustom(
      req,
      "Hapus kolom dan isinya",
      "custom.column.delete",
      async (w) => {
        await w.get("customColumn", req.params.id);
        await w.removeCells({ columnId: req.params.id });
        await w.remove("customColumn", req.params.id);
      },
    );
    res.json({ ok: true });
  });
  app.post("/api/admin/custom/rows", async (req, res) => {
    const { year } = z.object({ year: z.number().int().min(1).max(9999).optional() }).parse(req.body);
    const zone = (await settings()).zona_waktu;
    const bookYear = year || Number(inTimezone(new Date(), zone).slice(0, 4));
    res.json(await mutateCustom(req, "Tambah baris", "custom.row.create", async (w) =>
      w.add("customRow", await nextBookNumber(w.tx, req.mode, bookYear)),
    ));
  });
  app.patch("/api/admin/custom/rows/:id", async (req, res) => {
    const b = z.strictObject({
      color: color.optional(),
      ...Object.fromEntries(reviewKeys.map((key) => [key, reviewFields[key].optional()])),
      expectedReview: z.strictObject(reviewFields).partial().optional(),
      expectedBookYear: z.number().int().min(1).max(9999).nullable().optional(),
    }).refine((value) => ["color", ...reviewKeys].some((key) => value[key] !== undefined),
      "Pilih field baris yang akan diubah").parse(req.body);
    const changed = reviewKeys.filter((key) => b[key] !== undefined);
    if (changed.some((key) => b.expectedReview?.[key] === undefined))
      throw fail("Sertakan nilai review sebelumnya untuk setiap field yang diubah", 422);
    const data = Object.fromEntries(["color", ...changed].filter((key) => b[key] !== undefined).map((key) =>
      [key, key === "reviewNote" && !b[key]?.trim() ? null : b[key]]));
    const label = changed.length > 1 ? "Ubah review" : changed[0] === "reviewChecked"
      ? b.reviewChecked ? "Tandai dicek" : "Batalkan dicek"
      : changed[0] === "reviewFlag" ? "Ubah penanda" : changed[0] === "reviewNote" ? "Ubah catatan" : "Warna baris";
    try {
      res.json(await mutateCustom(req, label, changed.length ? "custom.row.review" : "custom.row.color", async (w) => {
        const row = await w.get("customRow", req.params.id);
        if (b.expectedBookYear !== undefined && row.bookYear !== b.expectedBookYear)
          throw fail("Baris telah berpindah tahun buku. Muat ulang sebelum menyimpan.", 409, reviewConflict(row, "CUSTOM_ROW_MOVED"));
        if (changed.some((key) => row[key] !== b.expectedReview[key]))
          throw fail("Review telah diubah admin lain. Pilih muat ulang atau simpan kembali dengan nilai terbaru sebagai pembanding.",
            409, reviewConflict(row));
        return w.patch("customRow", req.params.id, data);
      }));
    } catch (error) {
      if (changed.length && error.status === 409 && !error.details) {
        const row = await db.customRow.findFirst({ where: { id: req.params.id, mode: req.mode } });
        if (row) error.details = reviewConflict(row);
      }
      throw error;
    }
  });
  app.delete("/api/admin/custom/rows/:id", async (req, res) => {
    await mutateCustom(
      req,
      "Hapus baris dan isinya",
      "custom.row.delete",
      async (w) => {
        await w.get("customRow", req.params.id);
        await w.removeCells({ rowId: req.params.id });
        await w.remove("customRow", req.params.id);
      },
    );
    res.json({ ok: true });
  });
  app.put("/api/admin/custom/cell", async (req, res) => {
    const b = z
      .object({
        rowId: z.string(),
        columnId: z.string(),
        value: z
          .union([z.string().max(10000), z.number(), z.boolean()])
          .optional(),
        color: color.optional(),
      })
      .parse(req.body);
    res.json(
      await mutateCustom(
        req,
        b.value !== undefined ? "Edit sel" : "Warna sel",
        "custom.cell.update",
        async (w) => {
          const row = await w.get("customRow", b.rowId);
          const column = await w.get("customColumn", b.columnId);
          if (b.value !== undefined && b.value !== "") {
            if (column.type === "number") {
              const decimal = typeof b.value === "string" && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(b.value.trim());
              if ((typeof b.value !== "number" && !decimal) || !Number.isFinite(Number(b.value)))
                throw fail("Nilai harus angka desimal yang valid");
              b.value = Number(b.value);
            }
            if (
              column.type === "select" &&
              !column.options.includes(String(b.value))
            )
              throw fail("Opsi tidak valid");
            if (column.type === "checkbox" && typeof b.value !== "boolean")
              throw fail("Nilai harus checkbox");
            if (column.type === "date" && !validDate(String(b.value)))
              throw fail("Nilai harus tanggal");
          }
          const before = await w.tx.customCell.findUnique({
            where: { rowId_columnId: { rowId: b.rowId, columnId: b.columnId } },
          });
          const updated = before
            ? await w.patch("customCell", before.id, {
                value: b.value,
                color: b.color,
              })
            : await w.add("customCell", {
                rowId: b.rowId,
                columnId: b.columnId,
                value: b.value ?? "",
                color: b.color,
              });
          if (column.code === "invoice_date" && b.value !== undefined) {
            if (b.value !== "" && !validDate(String(b.value))) throw fail("Tanggal invoice harus valid");
            const source = b.value === "" && row.masterId
              ? await w.tx.submission.findUnique({ where: { id: row.masterId }, select: { submittedAt: true, documentSettings: true } })
              : null;
            const year = b.value !== "" ? invoiceYear(String(b.value))
              : source ? invoiceYear(undefined, source.submittedAt, source.documentSettings?.zona_waktu || "Asia/Jakarta") : row.bookYear;
            if (year && year !== row.bookYear)
              await w.patch("customRow", row.id, await nextBookNumber(w.tx, req.mode, year));
          }
          return { ...updated, bookRow: await w.get("customRow", row.id) };
        },
      ),
    );
  });
  app.post("/api/admin/custom/views", async (req, res) => {
    const b = z
      .object({
        name: z.string().min(1).max(100),
        config: z.object({
          columns: z.array(z.string()),
          sort: z.string().optional(),
          dir: z.enum(["asc", "desc"]).optional(),
          q: z.string().optional(),
          year: z.string().optional(),
        }),
      })
      .parse(req.body);
    res.json(
      await mutateCustom(req, "Simpan view", "custom.view.create", (w) =>
        w.add("customView", b),
      ),
    );
  });
  app.delete("/api/admin/custom/views/:id", async (req, res) => {
    await mutateCustom(req, "Hapus view", "custom.view.delete", (w) =>
      w.remove("customView", req.params.id),
    );
    res.json({ ok: true });
  });
}
