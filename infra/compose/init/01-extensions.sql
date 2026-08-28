-- Runs once, on first initialisation of an empty data directory.
-- pgcrypto  : column-level encryption + gen_random_uuid()  (spec section 8)
-- pg_trgm   : fuzzy patient search by name / MRN           (spec section 6, M2)
-- vector    : embeddings for the RAG FAQ assistant         (spec section 3.4)
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS vector;
