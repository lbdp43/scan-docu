/**
 * Crée UNIQUEMENT la table `card_mappings` si elle n'existe pas.
 *
 * Pourquoi pas `prisma db push` / `migrate` au démarrage ?
 * La base de prod a divergé du schema.prisma versionné (colonnes/tables en plus :
 * expenses.pennylane_invoice_id, pennylane_matched, receipt_image, expense_types,
 * settings...). `prisma db push` voudrait les supprimer (perte de données) et échoue,
 * ce qui empêchait le serveur de démarrer. Ce script est strictement additif et
 * non destructif : il ne touche qu'à `card_mappings`.
 *
 * Résilient : en cas d'erreur, on logge mais on n'empêche PAS le démarrage de l'app
 * (la page Rapprochement renverra une erreur gérée plutôt que de faire crash-looper tout).
 */
const { PrismaClient } = require('@prisma/client');

async function main() {
  const prisma = new PrismaClient();
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "card_mappings" (
        "id"            SERIAL PRIMARY KEY,
        "masked_number" VARCHAR(30) NOT NULL,
        "last4"         VARCHAR(4)  NOT NULL,
        "label"         VARCHAR(100),
        "scan_card_id"  VARCHAR(50),
        "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await prisma.$executeRawUnsafe(
      `CREATE UNIQUE INDEX IF NOT EXISTS "card_mappings_masked_number_key" ON "card_mappings" ("masked_number");`
    );
    console.log('[ensure-card-mappings] table card_mappings OK');
  } catch (e) {
    console.error('[ensure-card-mappings] avertissement (non bloquant):', e.message);
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('[ensure-card-mappings] erreur (non bloquant):', e.message);
    process.exit(0); // ne bloque jamais le démarrage de l'app
  });
