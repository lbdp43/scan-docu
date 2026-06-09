-- AlterTable
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "pennylane_invoice_id" VARCHAR(100);
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "pennylane_matched" BOOLEAN NOT NULL DEFAULT false;
