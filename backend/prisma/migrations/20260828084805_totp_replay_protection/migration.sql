-- Replay protection for TOTP: records the time step of the last accepted code
-- so the same code cannot be presented twice inside its window.
ALTER TABLE "users" ADD COLUMN "totp_last_step" INTEGER;

-- NOTE: `prisma migrate dev` also generated DROP INDEX statements for
-- patients_*_trgm_idx and protocol_chunks_embedding_idx. Those indexes are
-- created by hand in an earlier migration because Prisma's schema language
-- cannot express trigram or HNSW indexes — so Prisma sees them as drift and
-- proposes dropping them on every subsequent migration.
--
-- They were removed from this file deliberately. Every generated migration
-- must be read before it is applied; see docs/VERI-MODELI.md.
