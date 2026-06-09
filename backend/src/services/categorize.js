/**
 * Catégorisation analytique automatique (par "nature") des transactions carte.
 *
 * Pour chaque paiement carte NON catégorisé qui correspond (montant+date) à un
 * ticket scan-docu, on pose la catégorie analytique Pennylane selon le type :
 *   carburant -> Carburant · repas -> Restauration et Repas · péage -> Péages et Parking
 * ('autre' et types personnalisés : laissés non catégorisés).
 *
 * Non destructif : on ne touche PAS les transactions qui ont déjà une catégorie.
 * Idempotent : une fois catégorisée, une transaction est ignorée au run suivant.
 * Réversible : Pennylane PUT /transactions/{id}/categories [] retire les catégories.
 */
const pennylane = require('./pennylane');
const match = require('./match');
const { fiscalYear } = require('./fiscalYear');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// type de dépense scan-docu -> id catégorie analytique Pennylane (LBDP)
const TYPE_TO_CATEGORY = {
  carburant: 190533513216, // Carburant
  repas: 190538297344,     // Restauration et Repas
  peage: 190534152192,     // Péages et Parking
};

async function categorizeByType(db) {
  const token = await pennylane.getToken();
  if (!token) return { skipped: 'Pennylane non configuré' };

  const { from, to } = fiscalYear();
  const filter = [
    { field: 'date', operator: 'gteq', value: from },
    { field: 'date', operator: 'lteq', value: to },
  ];
  const bankId = await pennylane.getSavedBankAccountId();
  if (bankId) filter.push({ field: 'bank_account_id', operator: 'eq', value: bankId });

  let all = [];
  let cursor;
  do {
    const b = await pennylane.getTransactions({ filter, limit: 100, cursor });
    all = all.concat(b.items);
    cursor = b.has_more ? b.next_cursor : null;
    if (cursor) await pennylane.sleep(pennylane.RATE_LIMIT_DELAY);
  } while (cursor);
  const cardTx = all.filter((t) => Number(t.amount || t.currency_amount) < 0);

  const expRows = await (db || prisma).expense.findMany({
    where: { date_ticket: { gte: new Date(from) } },
    omit: { receipt_image: true },
  });
  const expenses = expRows.map((e) => ({
    amount: Number(e.amount),
    dateMs: match.dms(e.date_ticket),
    type: e.type,
  }));

  let categorized = 0;
  let errors = 0;
  for (const tx of cardTx) {
    if (tx.categories && tx.categories.length) continue; // déjà catégorisée -> on ne touche pas
    const a = Math.abs(Number(tx.amount || tx.currency_amount || 0));
    const tdms = match.dms(tx.date);
    let type = null;
    let best = 0;
    for (const e of expenses) {
      const s = match.expenseScore(e.amount, e.dateMs, a, tdms);
      if (s > best) { best = s; type = e.type; }
    }
    if (best < 25) continue;
    const catId = TYPE_TO_CATEGORY[type];
    if (!catId) continue; // 'autre'/type perso -> non catégorisé
    try {
      await pennylane.setTransactionCategories(tx.id, [{ id: catId, weight: '1.0' }]);
      categorized++;
      await pennylane.sleep(pennylane.RATE_LIMIT_DELAY);
    } catch (e) {
      errors++;
    }
  }
  return { considered: cardTx.length, categorized, errors };
}

module.exports = { categorizeByType, TYPE_TO_CATEGORY };
