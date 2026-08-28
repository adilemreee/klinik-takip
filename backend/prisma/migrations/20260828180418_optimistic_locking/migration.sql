-- Optimistic concurrency for the records staff edit (spec M15).
--
-- A client sends the version it read; a mismatch means someone else changed
-- the record in between. Clinical data is never silently overwritten, so the
-- write is refused and a human decides.
--
-- Existing rows start at 1, so a client holding a record read before this
-- migration sends no version and is treated as unversioned rather than stale.
ALTER TABLE "patients" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "medical_profiles" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

-- NOTE: `prisma migrate dev` also generated DROP INDEX statements for
-- patients_*_trgm_idx and protocol_chunks_embedding_idx. Those are created by
-- hand in an earlier migration because Prisma's schema language cannot express
-- trigram or HNSW indexes, so it sees them as drift on every diff. Removed
-- deliberately — see docs/VERI-MODELI.md.
