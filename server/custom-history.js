import crypto from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { db, audit, fail } from "./core.js";

const limit = 50;
const tables = new Set([
  "customRow",
  "customColumn",
  "customCell",
  "customView",
]);
const plain = (value) =>
  value == null ? null : JSON.parse(JSON.stringify(value));
const same = (a, b) => isDeepStrictEqual(plain(a), plain(b));
const historyId = (req) => `${req.mode}:${req.admin.id}`;
function status(state) {
  const undo = state?.undo || [],
    redo = state?.redo || [];
  return {
    undoCount: undo.length,
    redoCount: redo.length,
    undoId: undo.at(-1)?.id || null,
    redoId: redo.at(-1)?.id || null,
    undoLabel: undo.at(-1)?.label || "",
    redoLabel: redo.at(-1)?.label || "",
  };
}
export async function customHistoryStatus(client, req) {
  return status(
    await client.customHistory.findUnique({ where: { id: historyId(req) } }),
  );
}
async function lock(client, req) {
  // Serialize edits/history navigation for this admin and mode across browser tabs.
  return client.customHistory.upsert({
    where: { id: historyId(req) },
    create: {
      id: historyId(req),
      mode: req.mode,
      adminId: req.admin.id,
      undo: [],
      redo: [],
    },
    update: { revision: { increment: 1 } },
  });
}

export async function mutateCustom(req, label, action, fn) {
  return db
    .$transaction(
      async (tx) => {
        const state = await lock(tx, req),
          changes = [];
        const get = async (table, id) => {
          if (!tables.has(table)) throw Error("Tabel riwayat tidak valid");
          const row = await tx[table].findFirst({
            where: { id, mode: req.mode },
          });
          if (!row) throw fail("Data tabel kustom tidak ditemukan", 404);
          return row;
        };
        const writer = {
          tx,
          get,
          async add(table, data) {
            if (!tables.has(table)) throw Error("Tabel riwayat tidak valid");
            const after = await tx[table].create({
              data: { ...data, mode: req.mode },
            });
            changes.push({
              table,
              id: after.id,
              before: null,
              after: plain(after),
            });
            return after;
          },
          async patch(table, id, data) {
            const before = await get(table, id),
              after = await tx[table].update({ where: { id }, data });
            const keys = Object.keys(data).filter(
              (key) =>
                data[key] !== undefined && !same(before[key], after[key]),
            );
            if (keys.length)
              changes.push({
                table,
                id,
                before: plain(before),
                after: plain(after),
                keys,
              });
            return after;
          },
          async remove(table, id) {
            const before = await get(table, id);
            await tx[table].delete({ where: { id } });
            changes.push({ table, id, before: plain(before), after: null });
          },
          async removeCells(where) {
            const cells = await tx.customCell.findMany({
              where: { ...where, mode: req.mode },
            });
            if (cells.length)
              await tx.customCell.deleteMany({
                where: { ...where, mode: req.mode },
              });
            for (const cell of cells)
              changes.push({
                table: "customCell",
                id: cell.id,
                before: plain(cell),
                after: null,
              });
          },
        };
        const result = await fn(writer);
        if (changes.length) {
          const entry = {
            id: crypto.randomUUID(),
            label,
            at: new Date().toISOString(),
            changes,
          };
          await tx.customHistory.update({
            where: { id: state.id },
            data: { undo: [...state.undo, entry].slice(-limit), redo: [] },
          });
          await audit(
            req,
            action,
            changes.map((c) => ({ table: c.table, id: c.id, value: c.before })),
            changes.map((c) => ({ table: c.table, id: c.id, value: c.after })),
            req.mode,
            tx,
          );
        }
        return result;
      },
      { timeout: 120000, isolationLevel: "Serializable" },
    )
    .catch((e) => {
      if (e.code === "P2034")
        throw fail(
          "Data sedang diubah oleh admin lain. Muat ulang lalu coba lagi.",
          409,
        );
      throw e;
    });
}

export async function navigateCustomHistory(req, direction, expectedId) {
  try {
    return await db.$transaction(
      async (tx) => {
        const state = await lock(tx, req),
          source = state[direction],
          entry = source.at(-1);
        if (!entry)
          throw fail(
            direction === "undo"
              ? "Tidak ada perubahan untuk dibatalkan"
              : "Tidak ada perubahan untuk diulangi",
            409,
          );
        if (entry.id !== expectedId)
          throw fail(
            "Riwayat berubah di tab lain. Muat ulang tabel lalu coba lagi.",
            409,
          );
        const changes = (
          direction === "undo" ? [...entry.changes].reverse() : entry.changes
        ).map((c) => ({
          ...c,
          from: direction === "undo" ? c.after : c.before,
          to: direction === "undo" ? c.before : c.after,
        }));
        const conflict = () =>
          fail(
            "Undo/Redo ditolak karena data terkait sudah berubah. Muat ulang dan periksa perubahan admin lain; data mereka tetap dipertahankan.",
            409,
          );
        // Validate every precondition before writing anything. Patches compare only the
        // affected fields, so unrelated edits and automatically appended rows survive.
        for (const c of changes) {
          if (!tables.has(c.table)) throw conflict();
          const current = await tx[c.table].findFirst({
            where: { id: c.id, mode: req.mode },
          });
          if (c.keys) {
            if (!current || c.keys.some((k) => !same(current[k], c.from[k])))
              throw conflict();
          } else if (!same(current, c.from)) throw conflict();
          if (!c.to && ["customRow", "customColumn"].includes(c.table)) {
            const key = c.table === "customRow" ? "rowId" : "columnId";
            const cells = await tx.customCell.findMany({
              where: { mode: req.mode, [key]: c.id },
            });
            const deleted = new Set(
              changes
                .filter((x) => x.table === "customCell" && !x.to)
                .map((x) => x.id),
            );
            if (cells.some((cell) => !deleted.has(cell.id))) throw conflict();
          }
          if (!c.from && c.to) {
            if (
              c.table === "customRow" &&
              c.to.masterId &&
              (await tx.customRow.findFirst({
                where: { mode: req.mode, masterId: c.to.masterId },
              }))
            )
              throw conflict();
            if (
              c.table === "customColumn" &&
              (await tx.customColumn.findFirst({
                where: { mode: req.mode, code: c.to.code },
              }))
            )
              throw conflict();
            if (c.table === "customCell") {
              if (
                await tx.customCell.findFirst({
                  where: {
                    mode: req.mode,
                    rowId: c.to.rowId,
                    columnId: c.to.columnId,
                  },
                })
              )
                throw conflict();
              for (const [table, key] of [
                ["customRow", "rowId"],
                ["customColumn", "columnId"],
              ]) {
                const exists = await tx[table].findFirst({
                  where: { id: c.to[key], mode: req.mode },
                });
                if (
                  !exists &&
                  !changes.some(
                    (x) => x.table === table && x.id === c.to[key] && x.to,
                  )
                )
                  throw conflict();
              }
            }
          }
        }
        for (const c of changes) {
          if (!c.to) await tx[c.table].delete({ where: { id: c.id } });
          else if (!c.from) {
            const data = { ...c.to };
            if (c.table === "customRow")
              data.createdAt = new Date(data.createdAt);
            await tx[c.table].create({ data });
          } else {
            await tx[c.table].update({
              where: { id: c.id },
              data: Object.fromEntries(c.keys.map((k) => [k, c.to[k]])),
            });
          }
        }
        const opposite = direction === "undo" ? "redo" : "undo";
        const next = await tx.customHistory.update({
          where: { id: state.id },
          data: {
            [direction]: source.slice(0, -1),
            [opposite]: [...state[opposite], entry].slice(-limit),
          },
        });
        await audit(
          req,
          "custom." + direction,
          { entryId: entry.id, label: entry.label },
          {
            changes: changes.map((c) => ({
              table: c.table,
              id: c.id,
              before: c.from,
              after: c.to,
            })),
          },
          req.mode,
          tx,
        );
        return { ...status(next), label: entry.label };
      },
      { timeout: 120000, isolationLevel: "Serializable" },
    );
  } catch (e) {
    if (e.code === "P2002" || e.code === "P2025" || e.code === "P2034")
      throw fail(
        "Data terkait sudah berubah. Muat ulang tabel sebelum Undo/Redo.",
        409,
      );
    throw e;
  }
}
