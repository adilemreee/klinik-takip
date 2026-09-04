-- Patient search that finds "Ayşe Yılmaz" when somebody types "Ayse Yilmaz".
--
-- ILIKE is case-insensitive and not accent-insensitive, so a coordinator on a
-- keyboard without a Turkish layout — or an agency that entered a name without
-- diacritics — searched and found nothing. In a clinic that reads as "this
-- patient is not in the system", which is the worst answer a search can give.
--
-- A stored, folded column rather than folding in the query: `unaccent()` is not
-- IMMUTABLE, so it cannot be indexed directly, and folding at query time would
-- scan every row. The application writes this column with the same mapping (see
-- `foldForSearch` in patients.service.ts) and a test pins the two together.

ALTER TABLE "patients" ADD COLUMN IF NOT EXISTS "search_text" TEXT NOT NULL DEFAULT '';

-- The mapping, written out rather than delegated to unaccent's dictionary: it
-- has to match the application's character for character, and a dictionary that
-- changes with a PostgreSQL upgrade would silently stop matching.
UPDATE "patients"
SET "search_text" = translate(
  lower("first_name" || ' ' || "last_name" || ' ' || "mrn"),
  'ıİşŞğĞüÜöÖçÇâÂîÎûÛ',
  'iissgguuooccaaiiuu'
);

CREATE INDEX IF NOT EXISTS "patients_search_text_trgm_idx"
  ON "patients" USING gin ("search_text" gin_trgm_ops);

-- The per-column trigram indexes stay: exact-spelling search still uses them,
-- and dropping an index that something might still plan against is a change
-- with no upside here.
