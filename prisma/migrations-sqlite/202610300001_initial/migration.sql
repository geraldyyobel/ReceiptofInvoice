-- CreateTable
CREATE TABLE "admins" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'admin',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "adminId" TEXT NOT NULL,
    "csrf" TEXT NOT NULL,
    "mode" TEXT,
    "expiresAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "modes" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "reviewRequired" BOOLEAN NOT NULL DEFAULT true
);

-- CreateTable
CREATE TABLE "terms" (
    "mode" TEXT NOT NULL PRIMARY KEY,
    "publishedId" TEXT,
    "draft" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "terms_versions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mode" TEXT NOT NULL,
    "html" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "author" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "forms" (
    "mode" TEXT NOT NULL PRIMARY KEY,
    "currentId" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "form_versions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mode" TEXT NOT NULL,
    "fields" JSONB NOT NULL,
    "sections" JSONB NOT NULL,
    "note" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "form_fields" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mode" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "definition" JSONB NOT NULL
);

-- CreateTable
CREATE TABLE "submissions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mode" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "formVersionId" TEXT NOT NULL,
    "termsVersionId" TEXT NOT NULL,
    "templateVersionId" TEXT NOT NULL,
    "documentSettings" JSONB NOT NULL,
    "startedAt" DATETIME NOT NULL,
    "submittedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vendor" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'diterima',
    "values" JSONB NOT NULL
);

-- CreateTable
CREATE TABLE "submission_values" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "submissionId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "value" JSONB NOT NULL
);

-- CreateTable
CREATE TABLE "reference_counters" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" INTEGER NOT NULL DEFAULT 0
);

-- CreateTable
CREATE TABLE "custom_columns" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mode" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "options" JSONB NOT NULL,
    "position" INTEGER NOT NULL,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "color" TEXT
);

-- CreateTable
CREATE TABLE "custom_rows" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mode" TEXT NOT NULL,
    "masterId" TEXT,
    "color" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "custom_cells" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mode" TEXT NOT NULL,
    "rowId" TEXT NOT NULL,
    "columnId" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "color" TEXT
);

-- CreateTable
CREATE TABLE "custom_views" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "config" JSONB NOT NULL
);

-- CreateTable
CREATE TABLE "doc_templates" (
    "mode" TEXT NOT NULL PRIMARY KEY,
    "currentId" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "doc_template_versions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mode" TEXT NOT NULL,
    "html" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "author" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "uploads" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mode" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "public" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "activity_logs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mode" TEXT,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "ip" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "email_logs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mode" TEXT NOT NULL,
    "submissionId" TEXT,
    "recipient" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "backups" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "filename" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "settings" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" JSONB NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "admins_email_key" ON "admins"("email");

-- CreateIndex
CREATE INDEX "sessions_adminId_idx" ON "sessions"("adminId");

-- CreateIndex
CREATE INDEX "terms_versions_mode_createdAt_idx" ON "terms_versions"("mode", "createdAt");

-- CreateIndex
CREATE INDEX "form_versions_mode_createdAt_idx" ON "form_versions"("mode", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "form_fields_mode_code_key" ON "form_fields"("mode", "code");

-- CreateIndex
CREATE UNIQUE INDEX "submissions_reference_key" ON "submissions"("reference");

-- CreateIndex
CREATE INDEX "submissions_mode_submittedAt_idx" ON "submissions"("mode", "submittedAt");

-- CreateIndex
CREATE INDEX "submission_values_submissionId_idx" ON "submission_values"("submissionId");

-- CreateIndex
CREATE UNIQUE INDEX "custom_columns_mode_code_key" ON "custom_columns"("mode", "code");

-- CreateIndex
CREATE UNIQUE INDEX "custom_rows_mode_masterId_key" ON "custom_rows"("mode", "masterId");

-- CreateIndex
CREATE UNIQUE INDEX "custom_cells_rowId_columnId_key" ON "custom_cells"("rowId", "columnId");

-- CreateIndex
CREATE INDEX "activity_logs_mode_createdAt_idx" ON "activity_logs"("mode", "createdAt");

