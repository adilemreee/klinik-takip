-- Constraints and indexes Prisma's schema language cannot express.

-- ===========================================================================
-- audit_logs is append-only  (spec section 13)
-- ===========================================================================
--
-- Enforced by a trigger rather than by REVOKE. The application connects as the
-- database owner, and an owner's privileges cannot be revoked from it in any
-- meaningful way — it can always grant them back. A trigger stops the write
-- itself, so neither a bug in the ORM layer nor a compromised application
-- account can rewrite or erase history.
--
-- Disabling this trigger requires owner privileges and is a deliberate,
-- visible act rather than an accident.

CREATE OR REPLACE FUNCTION audit_logs_reject_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only; % is not permitted', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER audit_logs_no_update
  BEFORE UPDATE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION audit_logs_reject_mutation();

CREATE TRIGGER audit_logs_no_delete
  BEFORE DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION audit_logs_reject_mutation();

-- Row-level triggers do not fire for TRUNCATE, which would otherwise empty the
-- table in one statement.
CREATE TRIGGER audit_logs_no_truncate
  BEFORE TRUNCATE ON "audit_logs"
  FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_reject_mutation();

-- ===========================================================================
-- Patient search  (spec M2: name, file number, country, procedure, date range)
-- ===========================================================================
--
-- Staff search for partial and misspelled names, and for health tourism
-- patients the spelling in the system often differs from what is typed.
-- Trigram GIN indexes make ILIKE '%...%' and similarity() fast; a B-tree
-- cannot serve a leading wildcard at all.

CREATE INDEX "patients_last_name_trgm_idx"  ON "patients" USING gin ("last_name"  gin_trgm_ops);
CREATE INDEX "patients_first_name_trgm_idx" ON "patients" USING gin ("first_name" gin_trgm_ops);
CREATE INDEX "patients_mrn_trgm_idx"        ON "patients" USING gin ("mrn"        gin_trgm_ops);

-- ===========================================================================
-- RAG retrieval  (spec M4, section 3.4)
-- ===========================================================================
--
-- HNSW rather than IVFFlat: IVFFlat needs representative data present before
-- it can be trained, and this table starts empty. HNSW builds incrementally
-- and gives better recall at the same latency.
-- Cosine distance matches how the embeddings are normalised.

CREATE INDEX "protocol_chunks_embedding_idx"
  ON "protocol_chunks" USING hnsw ("embedding" vector_cosine_ops);

-- ===========================================================================
-- Partial indexes for the hot paths
-- ===========================================================================

-- Every staff-side patient list excludes soft-deleted rows; keeping them out of
-- the index makes it smaller and the scan cheaper.
CREATE INDEX "patients_active_idx"
  ON "patients" ("assigned_doctor_id", "status")
  WHERE "deleted_at" IS NULL;

-- The scheduler asks "what is due now" every minute; it only ever looks at
-- milestones that have not been handled.
CREATE INDEX "follow_up_milestones_due_idx"
  ON "follow_up_milestones" ("due_at")
  WHERE "status" = 'PENDING';

-- Same shape for the notification dispatcher.
CREATE INDEX "notifications_pending_idx"
  ON "notifications" ("scheduled_for")
  WHERE "status" = 'PENDING';

-- Messages held outside the access window, waiting to be released (spec M3).
CREATE INDEX "messages_queued_idx"
  ON "messages" ("queued_until")
  WHERE "status" = 'QUEUED';
