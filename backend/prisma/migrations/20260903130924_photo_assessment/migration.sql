-- Prisma generated four `DROP INDEX` statements here for the trigram, vector
-- and full-text indexes it does not model. They are removed by hand, as on
-- every migration that touches this schema: applying them would silently turn
-- patient search, the protocol vector lookup and the protocol text search into
-- sequential scans.

-- AlterTable
ALTER TABLE "photos" ADD COLUMN     "ai_assessed_at" TIMESTAMPTZ,
ADD COLUMN     "ai_findings" TEXT[],
ADD COLUMN     "ai_model" TEXT,
ADD COLUMN     "ai_review_suggested" BOOLEAN;

-- CreateIndex
CREATE INDEX "photos_ai_review_suggested_taken_at_idx" ON "photos"("ai_review_suggested", "taken_at");
