-- The durable record of queued work.
--
-- BullMQ keeps job state in Redis and drops jobs on its retention policy, which
-- is right for a queue and wrong for answering "what happened to the lab report
-- I uploaded last week". Redis is also not the system of record: a flush would
-- erase the history of everything the clinic has processed.
--
-- Prisma also generated DROP INDEX for the trigram and HNSW indexes, which it
-- cannot represent in the schema and therefore believes are drift. They are
-- created by hand in the audit_immutability_and_search_indexes migration and
-- must stay; the drops are removed deliberately.

-- CreateTable
CREATE TABLE "jobs" (
    "id" UUID NOT NULL,
    "queue" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "external_id" TEXT,
    "entity_type" TEXT,
    "entity_id" UUID,
    "patient_id" UUID,
    "status" "ProcessingStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "started_at" TIMESTAMPTZ,
    "finished_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "jobs_status_created_at_idx" ON "jobs"("status", "created_at");

-- CreateIndex
CREATE INDEX "jobs_entity_type_entity_id_created_at_idx" ON "jobs"("entity_type", "entity_id", "created_at");

-- CreateIndex
CREATE INDEX "jobs_patient_id_created_at_idx" ON "jobs"("patient_id", "created_at");
