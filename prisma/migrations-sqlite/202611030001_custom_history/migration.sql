CREATE TABLE "custom_history" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "mode" TEXT NOT NULL,
  "adminId" TEXT NOT NULL,
  "undo" JSONB NOT NULL,
  "redo" JSONB NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" DATETIME NOT NULL
);
CREATE INDEX "custom_history_mode_idx" ON "custom_history"("mode");
