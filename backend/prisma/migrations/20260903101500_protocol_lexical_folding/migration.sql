-- The lexical half of protocol retrieval, folded on both sides.
--
-- The first version indexed `to_tsvector('simple', content)` and searched it
-- with the patient's words as typed. Two things break that, and both are
-- ordinary rather than exotic:
--
--   - Turkish glues its endings on. The protocol says "pansumanınızı
--     değiştirin" and the patient asks "pansuman ne sıklıkla değiştirilmeli".
--     Nothing matches whole-word, and PostgreSQL ships no Turkish stemmer, so
--     the query side truncates each word to a prefix instead.
--   - Half of everyone types Turkish without its diacritics. "degistirme" and
--     "değiştirme" have to reach the same passage, so both sides lose them
--     through the same `translate`.
--
-- Created outside Prisma's model because an expression index has no
-- representation in the schema file. Like the trigram and vector indexes, it
-- must be stripped from every future generated migration.

DROP INDEX IF EXISTS "protocol_chunks_content_fts_idx";

CREATE INDEX "protocol_chunks_content_fts_idx"
  ON "protocol_chunks"
  USING gin (to_tsvector('simple', translate("content", 'ıİşŞğĞüÜöÖçÇâÂîÎûÛ', 'iIsSgGuUoOcCaAiIuU')));
