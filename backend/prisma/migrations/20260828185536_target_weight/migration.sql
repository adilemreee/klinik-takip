-- The weight the patient is working towards: the target line the weight and
-- BMI charts draw (spec M2). Decimal for the same reason every other weight is
-- one — 0.5 kg is a meaningful step and a binary float cannot hold it exactly.
--
-- Prisma also generated DROP INDEX for the trigram and HNSW indexes, which it
-- cannot represent in the schema and therefore believes are drift. They are
-- created by hand in the audit_immutability_and_search_indexes migration and
-- must stay; the drops are removed deliberately.
ALTER TABLE "medical_profiles" ADD COLUMN "target_weight_kg" DECIMAL(10,3);
