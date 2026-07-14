-- Mode de paiement + workflow de remboursement (notes de frais / espèces perso)
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "payment_method" VARCHAR(20) NOT NULL DEFAULT 'carte';
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "reimbursement_status" VARCHAR(20);
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "reimbursed_at" TIMESTAMP;
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "reimbursed_by" INTEGER;
CREATE INDEX IF NOT EXISTS "expenses_reimbursement_status_idx" ON "expenses" ("reimbursement_status");
