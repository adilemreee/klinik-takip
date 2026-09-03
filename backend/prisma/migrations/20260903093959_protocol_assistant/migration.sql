-- Prisma generated four `DROP INDEX` statements here for the trigram and HNSW
-- indexes it does not model. They are removed by hand, as on every migration
-- that touches this schema: applying them would silently turn patient search
-- and the protocol vector lookup into sequential scans.

-- AlterEnum
ALTER TYPE "AiJobType" ADD VALUE 'EMBEDDING';
ALTER TYPE "AiJobType" ADD VALUE 'ASSISTANT';

-- The lexical half of protocol retrieval (spec M4).
--
-- 'simple' rather than a language configuration: PostgreSQL ships no Turkish
-- stemmer, and 'english' would stem Turkish words into nonsense. Without
-- stemming the search is stricter than it could be, which is the right
-- direction here — a question that finds nothing is answered by a person, and
-- a question that finds the wrong passage is answered wrongly by a bot.
--
-- Created outside Prisma's model because an expression index has no
-- representation in the schema file. Like the trigram indexes, it must be
-- stripped from every future generated migration.
CREATE INDEX "protocol_chunks_content_fts_idx"
  ON "protocol_chunks" USING gin (to_tsvector('simple', "content"));
