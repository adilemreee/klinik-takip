-- Prisma generated four `DROP INDEX` statements here for the trigram and HNSW
-- indexes it does not model. They are removed by hand, as on every migration
-- that touches this schema: applying them would silently turn patient search
-- and the protocol vector lookup into sequential scans.

-- AlterEnum
--
-- `ADD VALUE` inside a transaction is allowed on PostgreSQL 12+; the new value
-- simply cannot be used until the transaction commits, which is fine — nothing
-- writes an EMERGENCY_ACCESS row until the application is running.
ALTER TYPE "AuditAction" ADD VALUE 'EMERGENCY_ACCESS';

-- AlterTable
ALTER TABLE "emergency_events" ADD COLUMN     "resolved_by_id" UUID;
