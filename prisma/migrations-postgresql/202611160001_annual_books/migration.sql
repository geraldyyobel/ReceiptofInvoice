ALTER TABLE "submissions" ADD COLUMN "bookYear" INTEGER;
ALTER TABLE "submissions" ADD COLUMN "bookNumber" INTEGER;
CREATE UNIQUE INDEX "submissions_mode_bookYear_bookNumber_key" ON "submissions" ("mode","bookYear","bookNumber");
ALTER TABLE "custom_rows" ADD COLUMN "bookYear" INTEGER;
ALTER TABLE "custom_rows" ADD COLUMN "bookNumber" INTEGER;
CREATE UNIQUE INDEX "custom_rows_mode_bookYear_bookNumber_key" ON "custom_rows" ("mode","bookYear","bookNumber");
CREATE INDEX "submissions_mode_bookYear_submittedAt_idx" ON "submissions" ("mode","bookYear","submittedAt");
CREATE INDEX "custom_cells_mode_rowId_idx" ON "custom_cells" ("mode","rowId");
CREATE INDEX "custom_cells_mode_columnId_rowId_idx" ON "custom_cells" ("mode","columnId","rowId");
