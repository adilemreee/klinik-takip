-- Canned replies a clinician sends with one tap (spec M3).
--
-- Prisma also generated DROP INDEX for the trigram and HNSW indexes, which it
-- cannot represent in the schema and therefore believes are drift. They are
-- created by hand in audit_immutability_and_search_indexes and must stay; the
-- drops are removed deliberately.

-- CreateTable
CREATE TABLE "quick_replies" (
    "id" UUID NOT NULL,
    "staff_id" UUID,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quick_replies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "quick_replies_staff_id_sort_order_idx" ON "quick_replies"("staff_id", "sort_order");
