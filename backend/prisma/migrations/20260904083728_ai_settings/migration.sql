-- CreateEnum
CREATE TYPE "AiProviderName" AS ENUM ('ANTHROPIC', 'OPENAI', 'GEMINI', 'DEEPSEEK');

-- CreateTable
CREATE TABLE "ai_settings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "provider" "AiProviderName",
    "model" TEXT,
    "api_key_encrypted" TEXT,
    "api_key_last4" TEXT,
    "input_price_per_mtok" DECIMAL(12,6),
    "output_price_per_mtok" DECIMAL(12,6),
    "zero_retention_confirmed" BOOLEAN NOT NULL DEFAULT false,
    "zero_retention_note" TEXT,
    "zero_retention_at" TIMESTAMPTZ,
    "monthly_budget_usd" DECIMAL(12,2),
    "updated_by_id" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "ai_settings_pkey" PRIMARY KEY ("id")
);
