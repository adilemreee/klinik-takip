-- Seven roles become three, and the matrix that described them becomes code.
--
-- Written by hand rather than generated, because two of the steps are ones a
-- generator gets wrong:
--
--   1. The audit log keeps its history. `actor_role` becomes text rather than
--      being remapped onto the surviving three, because it records the role
--      somebody held at the time — a nurse who read a file in August read it
--      as a nurse, and rewriting that would falsify the record.
--   2. Live rows are remapped, not dropped. SUPER_ADMIN and NURSE become
--      DOCTOR, FINANCE becomes COORDINATOR, CAREGIVER becomes PATIENT.

-- 1. History first: text keeps every value the column ever held, including the
--    four about to disappear. On a partitioned table this propagates to every
--    partition.
ALTER TABLE "audit_logs" ALTER COLUMN "actor_role" TYPE text USING "actor_role"::text;

-- 2. The matrix. `user_permissions` is dropped first: it references
--    `permissions`, and it has never had a row in it.
DROP TABLE IF EXISTS "user_permissions";
DROP TABLE IF EXISTS "role_permissions";
DROP TABLE IF EXISTS "permissions";

-- 3. The new enum, and the live columns moved onto it. Postgres cannot remove
--    a value from an enum in place, so this is a new type and a cast.
CREATE TYPE "Role_new" AS ENUM ('DOCTOR', 'COORDINATOR', 'PATIENT');

ALTER TABLE "users"
  ALTER COLUMN "role" TYPE "Role_new"
  USING (CASE "role"::text
    WHEN 'SUPER_ADMIN' THEN 'DOCTOR'
    WHEN 'NURSE'       THEN 'DOCTOR'
    WHEN 'FINANCE'     THEN 'COORDINATOR'
    WHEN 'CAREGIVER'   THEN 'PATIENT'
    ELSE "role"::text
  END)::"Role_new";

ALTER TABLE "invitations"
  ALTER COLUMN "role" TYPE "Role_new"
  USING (CASE "role"::text
    WHEN 'SUPER_ADMIN' THEN 'DOCTOR'
    WHEN 'NURSE'       THEN 'DOCTOR'
    WHEN 'FINANCE'     THEN 'COORDINATOR'
    WHEN 'CAREGIVER'   THEN 'PATIENT'
    ELSE "role"::text
  END)::"Role_new";

ALTER TABLE "patient_assignments"
  ALTER COLUMN "role" TYPE "Role_new"
  USING (CASE "role"::text
    WHEN 'SUPER_ADMIN' THEN 'DOCTOR'
    WHEN 'NURSE'       THEN 'DOCTOR'
    WHEN 'FINANCE'     THEN 'COORDINATOR'
    WHEN 'CAREGIVER'   THEN 'PATIENT'
    ELSE "role"::text
  END)::"Role_new";

DROP TYPE "Role";
ALTER TYPE "Role_new" RENAME TO "Role";
