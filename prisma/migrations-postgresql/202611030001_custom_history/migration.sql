CREATE TABLE "custom_history" (
  "id" TEXT NOT NULL,
  "mode" TEXT NOT NULL,
  "adminId" TEXT NOT NULL,
  "undo" JSONB NOT NULL,
  "redo" JSONB NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "custom_history_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "custom_history_mode_idx" ON "custom_history"("mode");
