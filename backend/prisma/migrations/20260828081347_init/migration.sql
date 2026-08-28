-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('SUPER_ADMIN', 'DOCTOR', 'NURSE', 'COORDINATOR', 'FINANCE', 'PATIENT', 'CAREGIVER');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('INVITED', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED');

-- CreateEnum
CREATE TYPE "Sex" AS ENUM ('FEMALE', 'MALE', 'OTHER', 'UNDISCLOSED');

-- CreateEnum
CREATE TYPE "PatientStatus" AS ENUM ('LEAD', 'SCHEDULED', 'PRE_OP', 'POST_OP', 'FOLLOW_UP', 'DISCHARGED', 'INACTIVE');

-- CreateEnum
CREATE TYPE "MeasurementType" AS ENUM ('WEIGHT', 'HEIGHT', 'BMI', 'BLOOD_PRESSURE', 'PULSE', 'TEMPERATURE', 'SPO2', 'GLUCOSE', 'WAIST');

-- CreateEnum
CREATE TYPE "MeasurementSource" AS ENUM ('PATIENT', 'NURSE', 'DEVICE');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('LAB', 'IMAGING', 'REPORT', 'CONSENT', 'INVOICE', 'PASSPORT', 'ECG', 'OTHER');

-- CreateEnum
CREATE TYPE "ProcessingStatus" AS ENUM ('PENDING', 'QUEUED', 'PROCESSING', 'DONE', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "LabFlag" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "PhotoCategory" AS ENUM ('BEFORE', 'AFTER', 'COMPLICATION', 'WOUND');

-- CreateEnum
CREATE TYPE "TriageLevel" AS ENUM ('INFO', 'ROUTINE', 'URGENT', 'EMERGENCY');

-- CreateEnum
CREATE TYPE "MessageType" AS ENUM ('TEXT', 'IMAGE', 'FILE', 'AUDIO', 'SYSTEM', 'BOT');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED');

-- CreateEnum
CREATE TYPE "AppointmentType" AS ENUM ('CONSULTATION', 'SURGERY', 'CONTROL', 'VIDEO_CALL');

-- CreateEnum
CREATE TYPE "AppointmentStatus" AS ENUM ('REQUESTED', 'CONFIRMED', 'CANCELLED', 'COMPLETED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "MilestoneStatus" AS ENUM ('PENDING', 'NOTIFIED', 'COMPLETED', 'MISSED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "MedicationSource" AS ENUM ('PRESCRIBED', 'PATIENT_REPORTED');

-- CreateEnum
CREATE TYPE "MedicationLogStatus" AS ENUM ('PENDING', 'TAKEN', 'SKIPPED', 'LATE', 'SNOOZED');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('PUSH', 'SMS', 'EMAIL', 'WHATSAPP', 'IN_APP');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED');

-- CreateEnum
CREATE TYPE "AiJobType" AS ENUM ('LAB_INTERPRETATION', 'MESSAGE_SUMMARY', 'TRIAGE', 'PHOTO_ASSESSMENT', 'DAILY_BRIEFING', 'OCR', 'TRANSLATION', 'DRUG_INTERACTION');

-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "EmergencyStatus" AS ENUM ('TRIGGERED', 'ACKNOWLEDGED', 'RESOLVED', 'FALSE_ALARM');

-- CreateEnum
CREATE TYPE "Currency" AS ENUM ('TRY', 'EUR', 'USD', 'GBP');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'PARTIAL', 'PAID', 'REFUNDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ConsentType" AS ENUM ('TREATMENT', 'DATA_PROCESSING', 'PHOTO_USAGE', 'MARKETING');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('CREATE', 'READ', 'UPDATE', 'DELETE', 'LOGIN', 'LOGIN_FAILED', 'LOGOUT', 'EXPORT', 'PERMISSION_CHANGE');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "role" "Role" NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "password_hash" TEXT,
    "totp_secret" TEXT,
    "totp_enabled_at" TIMESTAMPTZ,
    "locale" TEXT NOT NULL DEFAULT 'tr',
    "status" "UserStatus" NOT NULL DEFAULT 'INVITED',
    "last_login_at" TIMESTAMPTZ,
    "failed_login_attempts" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "refresh_token_hash" TEXT NOT NULL,
    "family_id" UUID NOT NULL,
    "device_name" TEXT,
    "platform" TEXT,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "last_seen_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "revoked_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitations" (
    "id" UUID NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "role" "Role" NOT NULL,
    "code_hash" TEXT NOT NULL,
    "invited_by_id" UUID NOT NULL,
    "patient_id" UUID,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "accepted_at" TIMESTAMPTZ,
    "revoked_at" TIMESTAMPTZ,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "role" "Role" NOT NULL,
    "permission_code" TEXT NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role","permission_code")
);

-- CreateTable
CREATE TABLE "user_permissions" (
    "user_id" UUID NOT NULL,
    "permission_code" TEXT NOT NULL,
    "granted" BOOLEAN NOT NULL DEFAULT true,
    "granted_by_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_permissions_pkey" PRIMARY KEY ("user_id","permission_code")
);

-- CreateTable
CREATE TABLE "staff_profiles" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "title" TEXT,
    "specialty" TEXT,
    "can_see_all_patients" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "staff_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patients" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "mrn" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "birth_date" DATE NOT NULL,
    "sex" "Sex" NOT NULL,
    "country" TEXT NOT NULL,
    "city" TEXT,
    "nationality" TEXT,
    "preferred_language" TEXT NOT NULL DEFAULT 'tr',
    "referral_source" TEXT,
    "status" "PatientStatus" NOT NULL DEFAULT 'LEAD',
    "assigned_doctor_id" UUID,
    "agency_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,
    "anonymized_at" TIMESTAMPTZ,

    CONSTRAINT "patients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "caregiver_links" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "caregiver_user_id" UUID NOT NULL,
    "relationship" TEXT,
    "consented_at" TIMESTAMPTZ NOT NULL,
    "revoked_at" TIMESTAMPTZ,

    CONSTRAINT "caregiver_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_assignments" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "staff_id" UUID NOT NULL,
    "role" "Role" NOT NULL,
    "assigned_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unassigned_at" TIMESTAMPTZ,

    CONSTRAINT "patient_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "medical_profiles" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "blood_type" TEXT,
    "allergies" TEXT[],
    "chronic_conditions" TEXT[],
    "current_medications" TEXT[],
    "smoking" BOOLEAN,
    "alcohol" BOOLEAN,
    "notes" TEXT,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "medical_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "surgeries" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "procedure_name" TEXT NOT NULL,
    "procedure_code" TEXT,
    "performed_at" TIMESTAMPTZ NOT NULL,
    "surgeon_id" UUID,
    "location" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "surgeries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "measurements" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "type" "MeasurementType" NOT NULL,
    "value" DECIMAL(10,3) NOT NULL,
    "secondary_value" DECIMAL(10,3),
    "unit" TEXT NOT NULL,
    "measured_at" TIMESTAMPTZ NOT NULL,
    "source" "MeasurementSource" NOT NULL,
    "recorded_by_id" UUID,
    "note" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "measurements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "uploaded_by_id" UUID,
    "type" "DocumentType" NOT NULL,
    "file_key" TEXT NOT NULL,
    "original_name" TEXT,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "checksum" TEXT,
    "page_count" INTEGER,
    "ocr_status" "ProcessingStatus" NOT NULL DEFAULT 'PENDING',
    "ai_status" "ProcessingStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lab_results" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "document_id" UUID,
    "analyte_code" TEXT,
    "analyte_name" TEXT NOT NULL,
    "value" DECIMAL(14,4) NOT NULL,
    "unit" TEXT NOT NULL,
    "ref_low" DECIMAL(14,4),
    "ref_high" DECIMAL(14,4),
    "flag" "LabFlag",
    "measured_at" TIMESTAMPTZ NOT NULL,
    "ocr_confidence" DECIMAL(5,4),
    "verified_by_id" UUID,
    "verified_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lab_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analyte_mappings" (
    "id" UUID NOT NULL,
    "raw_name" TEXT NOT NULL,
    "analyte_code" TEXT NOT NULL,
    "analyte_name" TEXT NOT NULL,
    "unit" TEXT,
    "mapped_by_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analyte_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "photos" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "category" "PhotoCategory" NOT NULL,
    "body_area" TEXT,
    "phase_label" TEXT,
    "file_key" TEXT NOT NULL,
    "thumbnail_key" TEXT,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "taken_at" TIMESTAMPTZ NOT NULL,
    "is_face_blurred" BOOLEAN NOT NULL DEFAULT false,
    "exif_stripped" BOOLEAN NOT NULL DEFAULT false,
    "consent_id" UUID,
    "uploaded_by_id" UUID,
    "note" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "photos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "subject" TEXT,
    "last_message_at" TIMESTAMPTZ,
    "closed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_participants" (
    "conversation_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "joined_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_read_at" TIMESTAMPTZ,

    CONSTRAINT "conversation_participants_pkey" PRIMARY KEY ("conversation_id","user_id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "sender_id" UUID,
    "type" "MessageType" NOT NULL DEFAULT 'TEXT',
    "body" TEXT,
    "original_language" TEXT,
    "translated_text" TEXT,
    "translated_to" TEXT,
    "media_key" TEXT,
    "transcript" TEXT,
    "ai_summary" TEXT,
    "ai_triage_level" "TriageLevel",
    "status" "MessageStatus" NOT NULL DEFAULT 'SENT',
    "queued_until" TIMESTAMPTZ,
    "delivered_at" TIMESTAMPTZ,
    "read_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "access_windows" (
    "id" UUID NOT NULL,
    "staff_id" UUID,
    "day_of_week" INTEGER NOT NULL,
    "start_time" TEXT NOT NULL,
    "end_time" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Istanbul',
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "access_windows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "protocol_documents" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "procedure_type" TEXT,
    "language" TEXT NOT NULL DEFAULT 'tr',
    "content" TEXT NOT NULL,
    "file_key" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "uploaded_by_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "protocol_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "protocol_chunks" (
    "id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "chunk_index" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "embedding" vector(1536),

    CONSTRAINT "protocol_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointments" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "staff_id" UUID,
    "type" "AppointmentType" NOT NULL,
    "status" "AppointmentStatus" NOT NULL DEFAULT 'REQUESTED',
    "scheduled_at" TIMESTAMPTZ NOT NULL,
    "duration_minutes" INTEGER NOT NULL DEFAULT 30,
    "location" TEXT,
    "meeting_url" TEXT,
    "note" TEXT,
    "cancelled_at" TIMESTAMPTZ,
    "cancelled_reason" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "appointments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "follow_up_schedules" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "surgery_id" UUID,
    "surgery_date" TIMESTAMPTZ NOT NULL,
    "template" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "follow_up_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "follow_up_milestones" (
    "id" UUID NOT NULL,
    "schedule_id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "due_at" TIMESTAMPTZ NOT NULL,
    "status" "MilestoneStatus" NOT NULL DEFAULT 'PENDING',
    "notified_at" TIMESTAMPTZ,
    "completed_at" TIMESTAMPTZ,

    CONSTRAINT "follow_up_milestones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "medications" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "drug_name" TEXT NOT NULL,
    "dose" TEXT NOT NULL,
    "form" TEXT,
    "frequency_rule" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "instructions" TEXT,
    "source" "MedicationSource" NOT NULL DEFAULT 'PRESCRIBED',
    "prescriber_id" UUID,
    "approved_by_id" UUID,
    "approved_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "stopped_at" TIMESTAMPTZ,

    CONSTRAINT "medications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "medication_logs" (
    "id" UUID NOT NULL,
    "medication_id" UUID NOT NULL,
    "scheduled_at" TIMESTAMPTZ NOT NULL,
    "taken_at" TIMESTAMPTZ,
    "status" "MedicationLogStatus" NOT NULL DEFAULT 'PENDING',
    "snoozed_until" TIMESTAMPTZ,
    "note" TEXT,

    CONSTRAINT "medication_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "data" JSONB,
    "actions" JSONB,
    "channel" "NotificationChannel" NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "fallback_for_id" UUID,
    "failure_reason" TEXT,
    "scheduled_for" TIMESTAMPTZ,
    "sent_at" TIMESTAMPTZ,
    "read_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "push_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "device_id" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMPTZ,

    CONSTRAINT "push_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "quiet_hours_start" TEXT,
    "quiet_hours_end" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Istanbul',

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_jobs" (
    "id" UUID NOT NULL,
    "type" "AiJobType" NOT NULL,
    "status" "ProcessingStatus" NOT NULL DEFAULT 'QUEUED',
    "input_ref" TEXT,
    "result_ref" TEXT,
    "model" TEXT,
    "tokens_in" INTEGER,
    "tokens_out" INTEGER,
    "cost_usd" DECIMAL(10,6),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "started_at" TIMESTAMPTZ,
    "finished_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_reports" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "content_md" TEXT NOT NULL,
    "patient_facing_md" TEXT,
    "riskLevel" "RiskLevel",
    "model" TEXT NOT NULL,
    "model_version" TEXT,
    "generated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_by_id" UUID,
    "reviewed_at" TIMESTAMPTZ,
    "released_to_patient_at" TIMESTAMPTZ,

    CONSTRAINT "ai_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "emergency_events" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "status" "EmergencyStatus" NOT NULL DEFAULT 'TRIGGERED',
    "triggered_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "note" TEXT,
    "escalation_level" INTEGER NOT NULL DEFAULT 0,
    "acknowledged_by_id" UUID,
    "acknowledged_at" TIMESTAMPTZ,
    "resolution" TEXT,
    "resolved_at" TIMESTAMPTZ,

    CONSTRAINT "emergency_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prom_surveys" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "procedure_type" TEXT,
    "questions" JSONB NOT NULL,
    "offset_days" INTEGER[],
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prom_surveys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prom_responses" (
    "id" UUID NOT NULL,
    "survey_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "answers" JSONB NOT NULL,
    "pain_score" INTEGER,
    "nps_score" INTEGER,
    "milestone_label" TEXT,
    "submitted_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prom_responses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agencies" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "country" TEXT,
    "contact_name" TEXT,
    "contact_email" TEXT,
    "contact_phone" TEXT,
    "commission_rate" DECIMAL(5,4),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_records" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "procedure_name" TEXT NOT NULL,
    "currency" "Currency" NOT NULL,
    "gross_amount" DECIMAL(14,2) NOT NULL,
    "discount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "net_amount" DECIMAL(14,2) NOT NULL,
    "cost_items" JSONB,
    "payment_status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "paid_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "paid_at" TIMESTAMPTZ,
    "agency_id" UUID,
    "agency_commission" DECIMAL(14,2),
    "note" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "finance_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exchange_rates" (
    "id" UUID NOT NULL,
    "base" "Currency" NOT NULL,
    "quote" "Currency" NOT NULL,
    "rate" DECIMAL(18,8) NOT NULL,
    "valid_on" DATE NOT NULL,

    CONSTRAINT "exchange_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consents" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "type" "ConsentType" NOT NULL,
    "version" INTEGER NOT NULL,
    "document_text" TEXT,
    "signature_file_key" TEXT,
    "signed_at" TIMESTAMPTZ NOT NULL,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "revoked_at" TIMESTAMPTZ,

    CONSTRAINT "consents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_requirements" (
    "id" UUID NOT NULL,
    "procedure_type" TEXT,
    "document_type" "DocumentType" NOT NULL,
    "label" TEXT NOT NULL,
    "is_mandatory" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "document_requirements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "actor_id" UUID,
    "actor_role" "Role",
    "action" "AuditAction" NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT,
    "before" JSONB,
    "after" JSONB,
    "patient_id" UUID,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "request_id" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- CreateIndex
CREATE INDEX "users_role_status_idx" ON "users"("role", "status");

-- CreateIndex
CREATE INDEX "users_status_created_at_idx" ON "users"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "device_sessions_refresh_token_hash_key" ON "device_sessions"("refresh_token_hash");

-- CreateIndex
CREATE INDEX "device_sessions_user_id_revoked_at_idx" ON "device_sessions"("user_id", "revoked_at");

-- CreateIndex
CREATE INDEX "device_sessions_family_id_idx" ON "device_sessions"("family_id");

-- CreateIndex
CREATE INDEX "device_sessions_expires_at_idx" ON "device_sessions"("expires_at");

-- CreateIndex
CREATE INDEX "invitations_email_idx" ON "invitations"("email");

-- CreateIndex
CREATE INDEX "invitations_phone_idx" ON "invitations"("phone");

-- CreateIndex
CREATE INDEX "invitations_expires_at_accepted_at_idx" ON "invitations"("expires_at", "accepted_at");

-- CreateIndex
CREATE UNIQUE INDEX "staff_profiles_user_id_key" ON "staff_profiles"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "patients_user_id_key" ON "patients"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "patients_mrn_key" ON "patients"("mrn");

-- CreateIndex
CREATE INDEX "patients_assigned_doctor_id_status_idx" ON "patients"("assigned_doctor_id", "status");

-- CreateIndex
CREATE INDEX "patients_status_created_at_idx" ON "patients"("status", "created_at");

-- CreateIndex
CREATE INDEX "patients_country_idx" ON "patients"("country");

-- CreateIndex
CREATE INDEX "patients_agency_id_idx" ON "patients"("agency_id");

-- CreateIndex
CREATE INDEX "patients_last_name_first_name_idx" ON "patients"("last_name", "first_name");

-- CreateIndex
CREATE INDEX "patients_deleted_at_idx" ON "patients"("deleted_at");

-- CreateIndex
CREATE INDEX "caregiver_links_caregiver_user_id_revoked_at_idx" ON "caregiver_links"("caregiver_user_id", "revoked_at");

-- CreateIndex
CREATE UNIQUE INDEX "caregiver_links_patient_id_caregiver_user_id_key" ON "caregiver_links"("patient_id", "caregiver_user_id");

-- CreateIndex
CREATE INDEX "patient_assignments_staff_id_unassigned_at_idx" ON "patient_assignments"("staff_id", "unassigned_at");

-- CreateIndex
CREATE INDEX "patient_assignments_patient_id_unassigned_at_idx" ON "patient_assignments"("patient_id", "unassigned_at");

-- CreateIndex
CREATE UNIQUE INDEX "medical_profiles_patient_id_key" ON "medical_profiles"("patient_id");

-- CreateIndex
CREATE INDEX "surgeries_patient_id_performed_at_idx" ON "surgeries"("patient_id", "performed_at");

-- CreateIndex
CREATE INDEX "surgeries_performed_at_idx" ON "surgeries"("performed_at");

-- CreateIndex
CREATE INDEX "measurements_patient_id_type_measured_at_idx" ON "measurements"("patient_id", "type", "measured_at");

-- CreateIndex
CREATE INDEX "documents_patient_id_created_at_idx" ON "documents"("patient_id", "created_at");

-- CreateIndex
CREATE INDEX "documents_ocr_status_idx" ON "documents"("ocr_status");

-- CreateIndex
CREATE INDEX "lab_results_patient_id_analyte_code_measured_at_idx" ON "lab_results"("patient_id", "analyte_code", "measured_at");

-- CreateIndex
CREATE INDEX "lab_results_patient_id_flag_idx" ON "lab_results"("patient_id", "flag");

-- CreateIndex
CREATE INDEX "lab_results_verified_at_idx" ON "lab_results"("verified_at");

-- CreateIndex
CREATE UNIQUE INDEX "analyte_mappings_raw_name_key" ON "analyte_mappings"("raw_name");

-- CreateIndex
CREATE INDEX "photos_patient_id_category_taken_at_idx" ON "photos"("patient_id", "category", "taken_at");

-- CreateIndex
CREATE INDEX "photos_patient_id_body_area_taken_at_idx" ON "photos"("patient_id", "body_area", "taken_at");

-- CreateIndex
CREATE INDEX "conversations_patient_id_last_message_at_idx" ON "conversations"("patient_id", "last_message_at");

-- CreateIndex
CREATE INDEX "conversation_participants_user_id_idx" ON "conversation_participants"("user_id");

-- CreateIndex
CREATE INDEX "messages_conversation_id_created_at_idx" ON "messages"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "messages_status_queued_until_idx" ON "messages"("status", "queued_until");

-- CreateIndex
CREATE INDEX "messages_ai_triage_level_created_at_idx" ON "messages"("ai_triage_level", "created_at");

-- CreateIndex
CREATE INDEX "access_windows_staff_id_day_of_week_idx" ON "access_windows"("staff_id", "day_of_week");

-- CreateIndex
CREATE INDEX "protocol_documents_procedure_type_language_is_active_idx" ON "protocol_documents"("procedure_type", "language", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "protocol_chunks_document_id_chunk_index_key" ON "protocol_chunks"("document_id", "chunk_index");

-- CreateIndex
CREATE INDEX "appointments_staff_id_scheduled_at_idx" ON "appointments"("staff_id", "scheduled_at");

-- CreateIndex
CREATE INDEX "appointments_patient_id_scheduled_at_idx" ON "appointments"("patient_id", "scheduled_at");

-- CreateIndex
CREATE INDEX "appointments_status_scheduled_at_idx" ON "appointments"("status", "scheduled_at");

-- CreateIndex
CREATE INDEX "follow_up_schedules_patient_id_idx" ON "follow_up_schedules"("patient_id");

-- CreateIndex
CREATE INDEX "follow_up_milestones_status_due_at_idx" ON "follow_up_milestones"("status", "due_at");

-- CreateIndex
CREATE INDEX "follow_up_milestones_schedule_id_idx" ON "follow_up_milestones"("schedule_id");

-- CreateIndex
CREATE INDEX "medications_patient_id_stopped_at_idx" ON "medications"("patient_id", "stopped_at");

-- CreateIndex
CREATE INDEX "medications_end_date_idx" ON "medications"("end_date");

-- CreateIndex
CREATE INDEX "medication_logs_status_scheduled_at_idx" ON "medication_logs"("status", "scheduled_at");

-- CreateIndex
CREATE UNIQUE INDEX "medication_logs_medication_id_scheduled_at_key" ON "medication_logs"("medication_id", "scheduled_at");

-- CreateIndex
CREATE INDEX "notifications_user_id_created_at_idx" ON "notifications"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "notifications_status_scheduled_for_idx" ON "notifications"("status", "scheduled_for");

-- CreateIndex
CREATE UNIQUE INDEX "push_tokens_token_key" ON "push_tokens"("token");

-- CreateIndex
CREATE INDEX "push_tokens_user_id_is_active_idx" ON "push_tokens"("user_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "notification_preferences_user_id_type_channel_key" ON "notification_preferences"("user_id", "type", "channel");

-- CreateIndex
CREATE INDEX "ai_jobs_status_created_at_idx" ON "ai_jobs"("status", "created_at");

-- CreateIndex
CREATE INDEX "ai_jobs_type_created_at_idx" ON "ai_jobs"("type", "created_at");

-- CreateIndex
CREATE INDEX "ai_reports_patient_id_generated_at_idx" ON "ai_reports"("patient_id", "generated_at");

-- CreateIndex
CREATE INDEX "ai_reports_riskLevel_reviewed_at_idx" ON "ai_reports"("riskLevel", "reviewed_at");

-- CreateIndex
CREATE INDEX "emergency_events_status_triggered_at_idx" ON "emergency_events"("status", "triggered_at");

-- CreateIndex
CREATE INDEX "emergency_events_patient_id_triggered_at_idx" ON "emergency_events"("patient_id", "triggered_at");

-- CreateIndex
CREATE INDEX "prom_responses_patient_id_submitted_at_idx" ON "prom_responses"("patient_id", "submitted_at");

-- CreateIndex
CREATE INDEX "prom_responses_survey_id_idx" ON "prom_responses"("survey_id");

-- CreateIndex
CREATE INDEX "finance_records_patient_id_idx" ON "finance_records"("patient_id");

-- CreateIndex
CREATE INDEX "finance_records_payment_status_created_at_idx" ON "finance_records"("payment_status", "created_at");

-- CreateIndex
CREATE INDEX "finance_records_created_at_idx" ON "finance_records"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "exchange_rates_base_quote_valid_on_key" ON "exchange_rates"("base", "quote", "valid_on");

-- CreateIndex
CREATE INDEX "consents_patient_id_type_revoked_at_idx" ON "consents"("patient_id", "type", "revoked_at");

-- CreateIndex
CREATE INDEX "audit_logs_actor_id_created_at_idx" ON "audit_logs"("actor_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_created_at_idx" ON "audit_logs"("entity_type", "entity_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_patient_id_created_at_idx" ON "audit_logs"("patient_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- AddForeignKey
ALTER TABLE "device_sessions" ADD CONSTRAINT "device_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invited_by_id_fkey" FOREIGN KEY ("invited_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_code_fkey" FOREIGN KEY ("permission_code") REFERENCES "permissions"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_permissions" ADD CONSTRAINT "user_permissions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_permissions" ADD CONSTRAINT "user_permissions_permission_code_fkey" FOREIGN KEY ("permission_code") REFERENCES "permissions"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_profiles" ADD CONSTRAINT "staff_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patients" ADD CONSTRAINT "patients_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patients" ADD CONSTRAINT "patients_assigned_doctor_id_fkey" FOREIGN KEY ("assigned_doctor_id") REFERENCES "staff_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patients" ADD CONSTRAINT "patients_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "caregiver_links" ADD CONSTRAINT "caregiver_links_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "caregiver_links" ADD CONSTRAINT "caregiver_links_caregiver_user_id_fkey" FOREIGN KEY ("caregiver_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_assignments" ADD CONSTRAINT "patient_assignments_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_assignments" ADD CONSTRAINT "patient_assignments_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medical_profiles" ADD CONSTRAINT "medical_profiles_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "surgeries" ADD CONSTRAINT "surgeries_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "measurements" ADD CONSTRAINT "measurements_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_results" ADD CONSTRAINT "lab_results_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_results" ADD CONSTRAINT "lab_results_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "photos" ADD CONSTRAINT "photos_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "photos" ADD CONSTRAINT "photos_consent_id_fkey" FOREIGN KEY ("consent_id") REFERENCES "consents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "protocol_chunks" ADD CONSTRAINT "protocol_chunks_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "protocol_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follow_up_schedules" ADD CONSTRAINT "follow_up_schedules_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follow_up_schedules" ADD CONSTRAINT "follow_up_schedules_surgery_id_fkey" FOREIGN KEY ("surgery_id") REFERENCES "surgeries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follow_up_milestones" ADD CONSTRAINT "follow_up_milestones_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "follow_up_schedules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medications" ADD CONSTRAINT "medications_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medications" ADD CONSTRAINT "medications_prescriber_id_fkey" FOREIGN KEY ("prescriber_id") REFERENCES "staff_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medication_logs" ADD CONSTRAINT "medication_logs_medication_id_fkey" FOREIGN KEY ("medication_id") REFERENCES "medications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_reports" ADD CONSTRAINT "ai_reports_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_events" ADD CONSTRAINT "emergency_events_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prom_responses" ADD CONSTRAINT "prom_responses_survey_id_fkey" FOREIGN KEY ("survey_id") REFERENCES "prom_surveys"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prom_responses" ADD CONSTRAINT "prom_responses_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_records" ADD CONSTRAINT "finance_records_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_records" ADD CONSTRAINT "finance_records_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consents" ADD CONSTRAINT "consents_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
