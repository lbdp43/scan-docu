-- AlterTable: widen type column
ALTER TABLE "expenses" ALTER COLUMN "type" TYPE VARCHAR(30);

-- CreateTable
CREATE TABLE "expense_types" (
    "id" SERIAL NOT NULL,
    "value" VARCHAR(30) NOT NULL,
    "label" VARCHAR(50) NOT NULL,
    "icon" VARCHAR(10) NOT NULL,
    "color" VARCHAR(20) NOT NULL DEFAULT '#6B7280',
    "position" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expense_types_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "expense_types_value_key" ON "expense_types"("value");

-- Seed default types
INSERT INTO "expense_types" ("value", "label", "icon", "color", "position") VALUES
    ('carburant', 'Carburant', '⛽', '#4A9E40', 0),
    ('repas', 'Repas', '🍽️', '#F97316', 1),
    ('peage', 'Péage', '🛣️', '#3B82F6', 2),
    ('autre', 'Autre', '📄', '#6B7280', 3)
ON CONFLICT ("value") DO NOTHING;
