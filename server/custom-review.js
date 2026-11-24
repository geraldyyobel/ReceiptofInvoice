import { z } from "zod";

export const reviewFields = {
  reviewChecked: z.boolean(),
  reviewFlag: z.enum(["followup", "problem"]).nullable(),
  reviewNote: z.string().max(2000).nullable(),
};
export const reviewKeys = Object.keys(reviewFields);
export const reviewFilters = ["unchecked", "flagged", "noted", "problem"];

// Old archives/history omit these fields; raw SQLite queries return 0/1.
export function reviewState(row) {
  return {
    reviewChecked: row.reviewChecked === true || row.reviewChecked === 1 || row.reviewChecked === 1n,
    reviewFlag: row.reviewFlag ?? null,
    reviewNote: row.reviewNote ?? null,
  };
}
export const withReviewDefaults = (row) => row == null ? row : { ...row, ...reviewState(row) };
export function reviewConflict(row, code = "CUSTOM_REVIEW_CONFLICT") {
  return { code, rowId: row.id, bookYear: row.bookYear, bookNumber: row.bookNumber, current: reviewState(row) };
}
