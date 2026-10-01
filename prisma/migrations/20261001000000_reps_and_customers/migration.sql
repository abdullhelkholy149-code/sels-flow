-- Phase 3: reps and customers
--
-- `reps` was created in the foundation; this migration grows `customers` into
-- the Section 5.1 master (the existing shell only had id/user_id/code/name) and
-- adds the rep assignment history and the customer ledger.
--
-- The assignment table enforces "at most one current rep per customer" with a
-- nullable unique `open_customer_id`: Postgres treats NULLs as distinct, so many
-- closed rows are allowed but only one open row survives. That is the schema
-- expressible equivalent of a partial unique index, which Prisma cannot declare
-- (decision D-021, and D-006 keeps migrations generated rather than hand edited).
--
-- The ledger is append only. Phase 3 writes the OPENING entry that carries a
-- customer's opening balance (Section 13); the balance is derived from the sum of
-- rows, never a source column (decision D-023).
--
-- The DDL below is the output of `prisma migrate diff --from-schema-datamodel
-- <phase 2 schema> --to-schema-datamodel prisma/schema.prisma`.

-- CreateEnum
CREATE TYPE "PaymentTerms" AS ENUM ('CASH', 'CREDIT');

-- CreateEnum
CREATE TYPE "CustomerStatus" AS ENUM ('ACTIVE', 'BLOCKED', 'INACTIVE');

-- CreateEnum
CREATE TYPE "ReceiverType" AS ENUM ('BUSINESS', 'PERSON', 'FOREIGN');

-- CreateEnum
CREATE TYPE "LedgerEntryType" AS ENUM ('OPENING', 'INVOICE', 'PAYMENT', 'CREDIT_NOTE', 'ADJUSTMENT');

-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "address" TEXT,
ADD COLUMN     "category_id" UUID,
ADD COLUMN     "city" TEXT,
ADD COLUMN     "contact_person" TEXT,
ADD COLUMN     "credit_days" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "credit_limit" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "governorate" TEXT,
ADD COLUMN     "lat" DECIMAL(10,7),
ADD COLUMN     "lng" DECIMAL(10,7),
ADD COLUMN     "national_id" TEXT,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "payment_terms" "PaymentTerms" NOT NULL DEFAULT 'CASH',
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "price_list_id" UUID,
ADD COLUMN     "receiver_type" "ReceiverType" NOT NULL DEFAULT 'BUSINESS',
ADD COLUMN     "status" "CustomerStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "tax_registration_number" TEXT,
ADD COLUMN     "trade_name" TEXT,
ADD COLUMN     "whatsapp_opt_in" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "customer_categories" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "name_en" TEXT,
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "customer_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_rep_assignments" (
    "id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "rep_id" UUID NOT NULL,
    "open_customer_id" UUID,
    "from_date" DATE NOT NULL,
    "to_date" DATE,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "customer_rep_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_ledger_entries" (
    "id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "entry_type" "LedgerEntryType" NOT NULL,
    "debit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "balance_after" DECIMAL(14,2) NOT NULL,
    "reference_type" TEXT,
    "reference_id" UUID,
    "notes" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "customer_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "customer_categories_name_key" ON "customer_categories"("name");

-- CreateIndex
CREATE INDEX "customer_categories_deleted_at_idx" ON "customer_categories"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "customer_rep_assignments_open_customer_id_key" ON "customer_rep_assignments"("open_customer_id");

-- CreateIndex
CREATE INDEX "customer_rep_assignments_customer_id_to_date_idx" ON "customer_rep_assignments"("customer_id", "to_date");

-- CreateIndex
CREATE INDEX "customer_rep_assignments_rep_id_to_date_idx" ON "customer_rep_assignments"("rep_id", "to_date");

-- CreateIndex
CREATE INDEX "customer_ledger_entries_customer_id_created_at_idx" ON "customer_ledger_entries"("customer_id", "created_at");

-- CreateIndex
CREATE INDEX "customer_ledger_entries_entry_type_idx" ON "customer_ledger_entries"("entry_type");

-- CreateIndex
CREATE INDEX "customers_status_idx" ON "customers"("status");

-- CreateIndex
CREATE INDEX "customers_category_id_idx" ON "customers"("category_id");

-- CreateIndex
CREATE INDEX "customers_price_list_id_idx" ON "customers"("price_list_id");

-- CreateIndex
CREATE INDEX "customers_name_idx" ON "customers"("name");

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "customer_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_price_list_id_fkey" FOREIGN KEY ("price_list_id") REFERENCES "price_lists"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_rep_assignments" ADD CONSTRAINT "customer_rep_assignments_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_rep_assignments" ADD CONSTRAINT "customer_rep_assignments_rep_id_fkey" FOREIGN KEY ("rep_id") REFERENCES "reps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_ledger_entries" ADD CONSTRAINT "customer_ledger_entries_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
