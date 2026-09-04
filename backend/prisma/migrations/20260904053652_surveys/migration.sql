-- CreateEnum
CREATE TYPE "SurveyAnswerType" AS ENUM ('SCALE_0_10', 'YES_NO', 'TEXT');

-- CreateEnum
CREATE TYPE "SurveyStatus" AS ENUM ('PENDING', 'SENT', 'COMPLETED', 'EXPIRED');

-- CreateTable
CREATE TABLE "survey_templates" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "questions" JSONB NOT NULL,
    "milestone_days" INTEGER[],
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "survey_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "survey_assignments" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "surgery_id" UUID,
    "milestone_days" INTEGER NOT NULL,
    "scheduled_for" TIMESTAMPTZ NOT NULL,
    "status" "SurveyStatus" NOT NULL DEFAULT 'PENDING',
    "sent_at" TIMESTAMPTZ,
    "expires_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "survey_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "survey_responses" (
    "id" UUID NOT NULL,
    "assignment_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "template_code" TEXT NOT NULL,
    "template_version" INTEGER NOT NULL,
    "answers" JSONB NOT NULL,
    "scores" JSONB NOT NULL,
    "answered_count" INTEGER NOT NULL,
    "question_count" INTEGER NOT NULL,
    "submitted_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "survey_responses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "survey_templates_code_is_active_idx" ON "survey_templates"("code", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "survey_templates_code_version_key" ON "survey_templates"("code", "version");

-- CreateIndex
CREATE INDEX "survey_assignments_status_scheduled_for_idx" ON "survey_assignments"("status", "scheduled_for");

-- CreateIndex
CREATE INDEX "survey_assignments_patient_id_scheduled_for_idx" ON "survey_assignments"("patient_id", "scheduled_for");

-- CreateIndex
CREATE UNIQUE INDEX "survey_assignments_patient_id_template_id_milestone_days_key" ON "survey_assignments"("patient_id", "template_id", "milestone_days");

-- CreateIndex
CREATE UNIQUE INDEX "survey_responses_assignment_id_key" ON "survey_responses"("assignment_id");

-- CreateIndex
CREATE INDEX "survey_responses_patient_id_submitted_at_idx" ON "survey_responses"("patient_id", "submitted_at");

-- AddForeignKey
ALTER TABLE "survey_assignments" ADD CONSTRAINT "survey_assignments_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "survey_assignments" ADD CONSTRAINT "survey_assignments_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "survey_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "survey_responses" ADD CONSTRAINT "survey_responses_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "survey_assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "survey_responses" ADD CONSTRAINT "survey_responses_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
