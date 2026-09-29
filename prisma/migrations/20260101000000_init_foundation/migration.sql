-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'REP', 'CUSTOMER', 'STOREKEEPER', 'ACCOUNTANT');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('LOGIN', 'LOGIN_FAILED', 'LOGOUT', 'PASSWORD_CHANGE', 'PASSWORD_RESET', 'ACCOUNT_LOCKED', 'ACCOUNT_UNLOCKED', 'CREATE', 'UPDATE', 'DELETE', 'STATUS_CHANGE', 'APPROVE', 'REJECT', 'CANCEL', 'CREDIT_OVERRIDE_GRANTED', 'CREDIT_OVERRIDE_REJECTED', 'STOCK_VOUCHER_POSTED', 'STOCK_VOUCHER_ACKNOWLEDGED', 'STOCK_COUNT_POSTED', 'CASH_HANDOVER_CONFIRMED', 'INVOICE_ISSUED', 'CREDIT_NOTE_ISSUED', 'PAYMENT_RECORDED', 'RETURN_RECEIVED', 'RATING_HIDDEN', 'MESSAGE_SENT', 'SETTINGS_UPDATED', 'EXPORT');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('ORDER', 'INVOICE', 'CREDIT_NOTE', 'STOCK_VOUCHER', 'STOCK_COUNT', 'PAYMENT', 'CASH_HANDOVER', 'RETURN_REQUEST', 'VISIT', 'CUSTOMER_CODE', 'PRODUCT_CODE', 'REP_CODE');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "role" "Role" NOT NULL,
    "username" TEXT,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "password_hash" TEXT NOT NULL,
    "must_change_password" BOOLEAN NOT NULL DEFAULT true,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMPTZ(6),
    "failed_login_count" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(6),
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "legal_name" TEXT NOT NULL,
    "tax_registration_number" TEXT,
    "branch_code" TEXT,
    "activity_code" TEXT,
    "address" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "logo_path" TEXT,
    "default_vat_rate" DECIMAL(5,2) NOT NULL DEFAULT 14,
    "invoice_prefix" TEXT NOT NULL DEFAULT 'INV',
    "credit_note_prefix" TEXT NOT NULL DEFAULT 'CN',
    "order_prefix" TEXT NOT NULL DEFAULT 'ORD',
    "return_window_days" INTEGER NOT NULL DEFAULT 7,
    "block_on_overdue" BOOLEAN NOT NULL DEFAULT true,
    "overdue_grace_days" INTEGER NOT NULL DEFAULT 3,
    "geofence_radius_m" INTEGER NOT NULL DEFAULT 200,
    "geofence_block" BOOLEAN NOT NULL DEFAULT false,
    "default_max_discount_percent" DECIMAL(5,2) NOT NULL DEFAULT 10,
    "whatsapp_enabled" BOOLEAN NOT NULL DEFAULT false,
    "default_credit_days" INTEGER NOT NULL DEFAULT 30,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "company_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "actor_user_id" UUID,
    "actor_role" "Role",
    "action" "AuditAction" NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "before_json" JSONB,
    "after_json" JSONB,
    "metadata" JSONB,
    "ip" TEXT,
    "user_agent" TEXT,
    "at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_counters" (
    "id" UUID NOT NULL,
    "doc_type" "DocumentType" NOT NULL,
    "year" INTEGER NOT NULL,
    "last_value" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "document_counters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reps" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "max_discount_percent" DECIMAL(5,2) NOT NULL DEFAULT 10,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "hired_at" DATE,
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "reps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_role_idx" ON "users"("role");

-- CreateIndex
CREATE INDEX "users_is_active_idx" ON "users"("is_active");

-- CreateIndex
CREATE INDEX "users_deleted_at_idx" ON "users"("deleted_at");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_actor_user_id_at_idx" ON "audit_logs"("actor_user_id", "at");

-- CreateIndex
CREATE INDEX "audit_logs_at_idx" ON "audit_logs"("at");

-- CreateIndex
CREATE INDEX "audit_logs_action_at_idx" ON "audit_logs"("action", "at");

-- CreateIndex
CREATE INDEX "document_counters_doc_type_idx" ON "document_counters"("doc_type");

-- CreateIndex
CREATE UNIQUE INDEX "document_counters_doc_type_year_key" ON "document_counters"("doc_type", "year");

-- CreateIndex
CREATE UNIQUE INDEX "reps_user_id_key" ON "reps"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "reps_code_key" ON "reps"("code");

-- CreateIndex
CREATE INDEX "reps_is_active_idx" ON "reps"("is_active");

-- CreateIndex
CREATE INDEX "reps_deleted_at_idx" ON "reps"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "customers_user_id_key" ON "customers"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "customers_code_key" ON "customers"("code");

-- CreateIndex
CREATE INDEX "customers_deleted_at_idx" ON "customers"("deleted_at");

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reps" ADD CONSTRAINT "reps_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

