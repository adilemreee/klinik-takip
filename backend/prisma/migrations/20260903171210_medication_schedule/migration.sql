-- Prisma generated `DROP INDEX` statements here for the trigram, vector and
-- full-text indexes it does not model. They are removed by hand, as on every
-- migration that touches this schema: applying them would silently turn patient
-- search, the protocol vector lookup and the protocol text search into
-- sequential scans.

-- AlterTable
ALTER TABLE "medication_logs" ADD COLUMN     "notified_at" TIMESTAMPTZ;

-- AlterTable
ALTER TABLE "medications" ADD COLUMN     "timezone" TEXT NOT NULL DEFAULT 'Europe/Istanbul';
