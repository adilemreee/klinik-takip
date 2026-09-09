-- The five DROP INDEX statements Prisma generated here have been removed.
--
-- They are the trigram indexes behind patient search and the HNSW index behind
-- the assistant's retrieval, all created by hand in earlier migrations because
-- Prisma cannot express them. Prisma proposes dropping them on every migration
-- because they are not in the schema, and applying that would leave both
-- features working and slow — the kind of regression nobody notices until a
-- clinic with ten thousand files complains.

-- CreateTable
CREATE TABLE "travel_plans" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "arrival_flight" TEXT,
    "arrival_at" TIMESTAMPTZ,
    "departure_flight" TEXT,
    "departure_at" TIMESTAMPTZ,
    "hotel_name" TEXT,
    "hotel_address" TEXT,
    "hotel_check_in" DATE,
    "hotel_check_out" DATE,
    "greeter_name" TEXT,
    "greeter_phone" TEXT,
    "transfer_note" TEXT,
    "interpreter_name" TEXT,
    "interpreter_language" TEXT,
    "interpreter_phone" TEXT,
    "cleared_to_fly_at" TIMESTAMPTZ,
    "cleared_to_fly_by_id" UUID,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "travel_plans_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "travel_plans_patient_id_key" ON "travel_plans"("patient_id");

-- AddForeignKey
ALTER TABLE "travel_plans" ADD CONSTRAINT "travel_plans_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
