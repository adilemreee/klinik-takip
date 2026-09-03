-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'CARD', 'BANK_TRANSFER', 'ONLINE', 'OTHER');

-- CreateEnum
CREATE TYPE "PaymentKind" AS ENUM ('PAYMENT', 'REFUND');

-- AlterTable
ALTER TABLE "exchange_rates" ADD COLUMN     "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "recorded_by_id" UUID;

-- AlterTable
ALTER TABLE "finance_records" ADD COLUMN     "cancelled_at" TIMESTAMPTZ;

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "finance_record_id" UUID NOT NULL,
    "kind" "PaymentKind" NOT NULL DEFAULT 'PAYMENT',
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" "Currency" NOT NULL,
    "applied_amount" DECIMAL(14,2) NOT NULL,
    "rate" DECIMAL(18,8),
    "method" "PaymentMethod" NOT NULL,
    "paid_at" TIMESTAMPTZ NOT NULL,
    "reference" TEXT,
    "note" TEXT,
    "reversed_at" TIMESTAMPTZ,
    "reversed_by_id" UUID,
    "reversal_reason" TEXT,
    "recorded_by_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payments_finance_record_id_idx" ON "payments"("finance_record_id");

-- CreateIndex
CREATE INDEX "payments_paid_at_idx" ON "payments"("paid_at");

-- CreateIndex
CREATE INDEX "exchange_rates_base_quote_valid_on_idx" ON "exchange_rates"("base", "quote", "valid_on");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_finance_record_id_fkey" FOREIGN KEY ("finance_record_id") REFERENCES "finance_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Money invariants, at the level that cannot be bypassed by a bug in the
-- service. A payment is always a positive amount; whether it adds or subtracts
-- is `kind`, so a stray minus sign cannot silently reverse a payment.
ALTER TABLE "payments"
  ADD CONSTRAINT "payments_amounts_positive"
  CHECK ("amount" > 0 AND "applied_amount" > 0);

-- The net is not an independent number: a bill whose net disagrees with its
-- gross and discount is wrong in whichever direction nobody is looking.
ALTER TABLE "finance_records"
  ADD CONSTRAINT "finance_records_amounts_consistent"
  CHECK (
    "gross_amount" >= 0
    AND "discount" >= 0
    AND "discount" <= "gross_amount"
    AND "net_amount" = "gross_amount" - "discount"
  );

-- A rate of zero or less is not a rate, and would divide by zero on the
-- inverse.
ALTER TABLE "exchange_rates"
  ADD CONSTRAINT "exchange_rates_rate_positive"
  CHECK ("rate" > 0);
