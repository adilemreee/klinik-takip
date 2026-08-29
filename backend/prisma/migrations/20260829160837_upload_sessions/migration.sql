-- Resumable uploads (spec section 9).
--
-- The session lives in the database because the point of it is surviving
-- things: a dropped connection, an app backgrounded, a server restart. A
-- patient abroad on mobile data who has sent 18 of 20 MB must not start again.
--
-- Prisma also generated DROP INDEX for the trigram and HNSW indexes, which it
-- cannot represent in the schema and therefore believes are drift. They are
-- created by hand in audit_immutability_and_search_indexes and must stay; the
-- drops are removed deliberately.

-- CreateEnum
CREATE TYPE "UploadStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'ABORTED');

-- CreateTable
CREATE TABLE "upload_sessions" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "created_by_id" UUID,
    "document_type" "DocumentType" NOT NULL,
    "original_name" TEXT,
    "mime" TEXT,
    "received_bytes" INTEGER NOT NULL DEFAULT 0,
    "part_count" INTEGER NOT NULL DEFAULT 0,
    "status" "UploadStatus" NOT NULL DEFAULT 'ACTIVE',
    "expires_at" TIMESTAMPTZ NOT NULL,
    "document_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "upload_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "upload_sessions_patient_id_created_at_idx" ON "upload_sessions"("patient_id", "created_at");

-- CreateIndex
CREATE INDEX "upload_sessions_status_expires_at_idx" ON "upload_sessions"("status", "expires_at");

-- AddForeignKey
ALTER TABLE "upload_sessions" ADD CONSTRAINT "upload_sessions_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
