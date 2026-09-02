-- Complications a patient reports themselves (spec M7).
--
-- Not the panic button: this is "something looks wrong with my wound". It goes
-- straight to a clinician, and how long it waited is part of the record — the
-- spec asks for the response time to be measured, and a number nobody stores is
-- a number nobody measures.
--
-- Prisma also generated DROP INDEX for the trigram and HNSW indexes, which it
-- cannot represent in the schema and therefore believes are drift. They are
-- created by hand in audit_immutability_and_search_indexes and must stay; the
-- drops are removed deliberately.

-- CreateEnum
CREATE TYPE "ComplicationStatus" AS ENUM ('REPORTED', 'ACKNOWLEDGED', 'RESOLVED');

-- AlterTable
ALTER TABLE "photos" ADD COLUMN     "complication_id" UUID;

-- CreateTable
CREATE TABLE "complications" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "status" "ComplicationStatus" NOT NULL DEFAULT 'REPORTED',
    "note" TEXT NOT NULL,
    "body_area" TEXT,
    "reported_by_id" UUID,
    "reported_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledged_by_id" UUID,
    "acknowledged_at" TIMESTAMPTZ,
    "first_response" TEXT,
    "resolved_by_id" UUID,
    "resolved_at" TIMESTAMPTZ,
    "resolution" TEXT,

    CONSTRAINT "complications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "complications_status_reported_at_idx" ON "complications"("status", "reported_at");

-- CreateIndex
CREATE INDEX "complications_patient_id_reported_at_idx" ON "complications"("patient_id", "reported_at");

-- AddForeignKey
ALTER TABLE "photos" ADD CONSTRAINT "photos_complication_id_fkey" FOREIGN KEY ("complication_id") REFERENCES "complications"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "complications" ADD CONSTRAINT "complications_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
