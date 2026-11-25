import { test } from "node:test";
import assert from "node:assert/strict";
import { panelState, dirtyReview, mergePanelRow, acceptReviewSave, sameCell } from "../shared/custom-panel-state.js";
const row = { id: "row-a", bookYear: 2091, reviewChecked: false, reviewFlag: null, reviewNote: null };
test("review hanya mengirim perubahan; catatan kosong diperlakukan sebagai null", () => {
  const s = panelState(row); s.draft.reviewNote = " \n "; assert.deepEqual(dirtyReview(s), []);
  s.draft.reviewChecked = true; assert.deepEqual(dirtyReview(s), ["reviewChecked"]);
});
test("respons simpan tidak menghapus teks yang diketik selama permintaan berlangsung", () => {
  const s = panelState(row); s.draft.reviewNote = "Draf berikutnya";
  const result = acceptReviewSave(s, { ...row, reviewNote: "Teks terkirim" }, { reviewNote: "Teks terkirim" }, 0);
  assert.equal(result.base.reviewNote, "Teks terkirim"); assert.equal(result.draft.reviewNote, "Draf berikutnya");
  assert.deepEqual(dirtyReview(result), ["reviewNote"]);
});
test("konflik dari pembacaan ulang mempertahankan draf dan menyertakan nilai server", () => {
  const s = panelState(row); s.draft.reviewNote = "Draf saya";
  const result = mergePanelRow(s, { ...row, reviewNote: "Admin lain", reviewChecked: true });
  assert.equal(result.draft.reviewNote, "Draf saya"); assert.equal(result.conflict.current.reviewNote, "Admin lain");
  assert.equal(result.draft.reviewChecked, true);
});
test("respons lama setelah pindah tahun tidak mengubah metadata atau menghapus draf", () => {
  const s = panelState(row); s.draft.reviewNote = "Draf saya";
  const moved = mergePanelRow(s, { ...row, bookYear: 2092 });
  assert.equal(moved.unavailable, "moved"); assert.equal(moved.context, 1);
  assert.equal(acceptReviewSave(moved, { ...row, reviewNote: "Draf saya" }, { reviewNote: "Draf saya" }, 0), moved);
});
test("pembanding master membedakan tipe angka/checkbox, teks dan nilai kosong", () => {
  assert.equal(sameCell("12.50", 12.5, "number"), true); assert.equal(sameCell("", null, "short"), true);
  assert.equal(sameCell("true", true, "checkbox"), true); assert.equal(sameCell("001", "1", "short"), false);
});
test("membuka kembali draf tidak mewarisi status sel menyimpan yang terputus", () => {
  const cached = { ...panelState(row), cellsSaving: { c1: true }, cellDrafts: { c1: "Draf sel" } };
  const result = panelState(row, cached);
  assert.equal(result.cellDrafts.c1, "Draf sel"); assert.deepEqual(result.cellsSaving, {});
  assert.match(result.cellErrors.c1, /belum terkonfirmasi/);
});
