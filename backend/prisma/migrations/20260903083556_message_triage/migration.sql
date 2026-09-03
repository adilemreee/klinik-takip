-- Prisma generated four further `DROP INDEX` statements here for the trigram
-- and HNSW indexes it does not model. They are removed by hand, as on every
-- migration that touches this schema: applying them would silently turn patient
-- search and the protocol vector lookup into sequential scans.
--
-- The drop below is deliberate. The clinician's queue reads "what is urgent and
-- unanswered", which is the level the clinic acted on rather than the level the
-- model suggested, so the index moves with it.

-- DropIndex
DROP INDEX "messages_ai_triage_level_created_at_idx";

-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "triage_flags" TEXT[],
ADD COLUMN     "triage_level" "TriageLevel";

-- CreateIndex
CREATE INDEX "messages_triage_level_created_at_idx" ON "messages"("triage_level", "created_at");
