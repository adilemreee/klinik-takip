-- Staff availability, and which appointment reminders have already gone.
--
-- availability_windows is deliberately not access_windows: one says when the
-- clinic reads messages, the other when it can see patients, and a doctor who
-- answers messages at midnight is not offering midnight appointments.
--
-- Prisma also generated DROP INDEX for the trigram and HNSW indexes, which it
-- cannot represent in the schema and therefore believes are drift. They are
-- created by hand in audit_immutability_and_search_indexes and must stay; the
-- drops are removed deliberately.

-- AlterTable
ALTER TABLE "appointments" ADD COLUMN     "reminders_sent" TEXT[];

-- CreateTable
CREATE TABLE "availability_windows" (
    "id" UUID NOT NULL,
    "staff_id" UUID NOT NULL,
    "day_of_week" INTEGER NOT NULL,
    "start_time" TEXT NOT NULL,
    "end_time" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Istanbul',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "availability_windows_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "availability_windows_staff_id_day_of_week_idx" ON "availability_windows"("staff_id", "day_of_week");

-- AddForeignKey
ALTER TABLE "availability_windows" ADD CONSTRAINT "availability_windows_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
