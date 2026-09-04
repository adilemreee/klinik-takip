-- ===========================================================================
-- audit_logs becomes range-partitioned by month  (spec section 13)
-- ===========================================================================
--
-- Done now, while the table holds tens of rows, because the alternative is
-- doing it later: converting a table with years of audit history in it means
-- either downtime or an online copy with a swap, on the one table that must
-- not lose a row. Eighteen rows move in a millisecond.
--
-- Range on `created_at` because that is how this table is read (a review asks
-- about a period) and how it is retired (a retention rule drops a month by
-- detaching a partition rather than by DELETE — which the append-only trigger
-- would refuse anyway).
--
-- Prisma cannot express partitioning, so the table is built here in raw SQL
-- and the model carries the composite primary key that a partitioned table
-- requires.

-- ---------------------------------------------------------------------------
-- The new table
-- ---------------------------------------------------------------------------
--
-- Built under the final name from the start, so the helper below can refer to
-- it. The old table steps aside first.

ALTER TABLE "audit_logs" RENAME TO "audit_logs_legacy";
--
-- The primary key has to contain the partition key, so it is (id, created_at)
-- rather than (id). `id` is UUIDv7 and still unique on its own in practice;
-- the composite key is a requirement of partitioning, not a change of meaning.

CREATE TABLE "audit_logs" (
  "id"          UUID         NOT NULL,
  "actor_id"    UUID,
  "actor_role"  "Role",
  "action"      "AuditAction" NOT NULL,
  "entity_type" TEXT         NOT NULL,
  "entity_id"   TEXT,
  "before"      JSONB,
  "after"       JSONB,
  "patient_id"  UUID,
  "ip_address"  TEXT,
  "user_agent"  TEXT,
  "request_id"  TEXT,
  "created_at"  TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "audit_logs_new_pkey" PRIMARY KEY ("id", "created_at")
) PARTITION BY RANGE ("created_at");

-- ---------------------------------------------------------------------------
-- Making a month
-- ---------------------------------------------------------------------------
--
-- A function rather than a list of CREATE TABLE statements, because the months
-- keep coming. Called by the worker's sweep to build the next few ahead of
-- time, and idempotent so running it again is free.

CREATE OR REPLACE FUNCTION audit_logs_ensure_partition(p_month date)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  v_start date := date_trunc('month', p_month)::date;
  v_end   date := (date_trunc('month', p_month) + interval '1 month')::date;
  v_name  text := format('audit_logs_%s', to_char(v_start, 'YYYY_MM'));
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = v_name) THEN
    RETURN v_name;
  END IF;

  EXECUTE format(
    'CREATE TABLE %I PARTITION OF "audit_logs" FOR VALUES FROM (%L) TO (%L)',
    v_name, v_start, v_end
  );

  -- Row-level UPDATE and DELETE triggers declared on the parent are inherited
  -- by every partition. TRUNCATE triggers are statement-level and are **not**,
  -- so a partition created without one would be a hole in the append-only
  -- rule: `TRUNCATE audit_logs_2027_03` would empty a month of history.
  EXECUTE format(
    'CREATE TRIGGER %I BEFORE TRUNCATE ON %I '
    'FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_reject_mutation()',
    v_name || '_no_truncate', v_name
  );

  RETURN v_name;
END;
$$;

-- ---------------------------------------------------------------------------
-- The safety net
-- ---------------------------------------------------------------------------
--
-- A default partition, so an INSERT can never fail for want of a partition.
-- The failure being avoided is specific and bad: an audit write that throws
-- either rolls back the action it was recording, or loses the record of it.
-- Neither is acceptable on this table, so a row with nowhere else to go lands
-- here and is still recorded.
--
-- In normal operation it stays empty — the sweep builds months ahead. A row in
-- here is a signal that something is wrong, not a resting place.

-- Every month the history already covers, plus a window around today. These
-- come **before** the default partition and before the copy: a row that lands
-- in the default makes it impossible to create the partition it belongs in
-- afterwards, which is a hole that only shows up on the next deployment.

SELECT audit_logs_ensure_partition(month::date)
FROM (
  SELECT DISTINCT date_trunc('month', "created_at") AS month FROM "audit_logs_legacy"
) AS months;

SELECT audit_logs_ensure_partition((date_trunc('month', CURRENT_DATE) + (n || ' month')::interval)::date)
FROM generate_series(-2, 3) AS n;

CREATE TABLE "audit_logs_default" PARTITION OF "audit_logs" DEFAULT;

CREATE TRIGGER "audit_logs_default_no_truncate"
  BEFORE TRUNCATE ON "audit_logs_default"
  FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_reject_mutation();

-- ---------------------------------------------------------------------------
-- Move the history across, then swap
-- ---------------------------------------------------------------------------

INSERT INTO "audit_logs" (
  "id", "actor_id", "actor_role", "action", "entity_type", "entity_id",
  "before", "after", "patient_id", "ip_address", "user_agent", "request_id",
  "created_at"
)
SELECT
  "id", "actor_id", "actor_role", "action", "entity_type", "entity_id",
  "before", "after", "patient_id", "ip_address", "user_agent", "request_id",
  "created_at"
FROM "audit_logs_legacy";

-- The old table's triggers reject UPDATE, DELETE and TRUNCATE. DROP is none of
-- those, and the rows are already copied. Dropping it also frees the index and
-- constraint names the new table takes below.
DROP TABLE "audit_logs_legacy";

ALTER TABLE "audit_logs" RENAME CONSTRAINT "audit_logs_new_pkey" TO "audit_logs_pkey";

-- ---------------------------------------------------------------------------
-- Indexes and the append-only rule, rebuilt on the parent
-- ---------------------------------------------------------------------------
--
-- Indexes declared on a partitioned table are created on every partition,
-- present and future.

CREATE INDEX "audit_logs_actor_id_created_at_idx" ON "audit_logs" ("actor_id", "created_at");
CREATE INDEX "audit_logs_entity_type_entity_id_created_at_idx"
  ON "audit_logs" ("entity_type", "entity_id", "created_at");
CREATE INDEX "audit_logs_patient_id_created_at_idx" ON "audit_logs" ("patient_id", "created_at");
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs" ("created_at");

-- Inherited by every partition, including ones created later.
CREATE TRIGGER "audit_logs_no_update"
  BEFORE UPDATE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION audit_logs_reject_mutation();

CREATE TRIGGER "audit_logs_no_delete"
  BEFORE DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION audit_logs_reject_mutation();

-- On the parent, this catches `TRUNCATE audit_logs`. Each partition gets its
-- own in `audit_logs_ensure_partition`, which catches truncating one directly.
CREATE TRIGGER "audit_logs_no_truncate"
  BEFORE TRUNCATE ON "audit_logs"
  FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_reject_mutation();
