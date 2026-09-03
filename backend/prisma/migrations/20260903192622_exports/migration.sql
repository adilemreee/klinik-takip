-- CreateEnum
CREATE TYPE "ExportKind" AS ENUM ('PATIENT_SUMMARY');

-- CreateTable
CREATE TABLE "exports" (
    "id" UUID NOT NULL,
    "kind" "ExportKind" NOT NULL,
    "status" "ProcessingStatus" NOT NULL DEFAULT 'QUEUED',
    "requested_by_id" UUID NOT NULL,
    "patient_id" UUID,
    "params" JSONB,
    "contents" JSONB,
    "file_key" TEXT,
    "mime" TEXT,
    "size" INTEGER,
    "error" TEXT,
    "started_at" TIMESTAMPTZ,
    "finished_at" TIMESTAMPTZ,
    "expires_at" TIMESTAMPTZ,
    "downloaded_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "exports_requested_by_id_created_at_idx" ON "exports"("requested_by_id", "created_at");

-- CreateIndex
CREATE INDEX "exports_patient_id_created_at_idx" ON "exports"("patient_id", "created_at");

-- CreateIndex
CREATE INDEX "exports_status_created_at_idx" ON "exports"("status", "created_at");

-- CreateIndex
CREATE INDEX "exports_expires_at_idx" ON "exports"("expires_at");

-- AddForeignKey
ALTER TABLE "exports" ADD CONSTRAINT "exports_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
