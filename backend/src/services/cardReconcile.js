/**
 * Rapprochement direct carte (montant + date), pensé pour tourner toutes les heures
 * après la synchro Drive -> Pennylane.
 *
 * Relie les factures fournisseur (issues de l'import Drive, NON archivées, NON déjà
 * rapprochées) à leur transaction carte du compte Pro, par montant exact + date
 * (paiement de J-1 à J+7 du ticket).
 *
 * Idempotent et sûr :
 *  - suivi des factures déjà traitées dans Setting ("cron_reconciled_invoices")
 *  - avant de grouper, on vérifie que la transaction n'a PAS déjà une facture liée
 *    (évite de double-justifier un paiement).
 */
const pennylane = require('./pennylane');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const TRACK_KEY = 'cron_reconciled_invoices';

async function getTracked() {
  try {
    const r = await prisma.setting.findUnique({ where: { key: TRACK_KEY } });
    return new Set(r?.value ? JSON.parse(r.value) : []);
  } catch {
    return new Set();
  }
}
async function saveTracked(set) {
  await prisma.setting.upsert({
    where: { key: TRACK_KEY },
    update: { value: JSON.stringify([...set]) },
    create: { key: TRACK_KEY, value: JSON.stringify([...set]) },
  });
}

const day = (s) => {
  const t = Date.parse(String(s).slice(0, 10));
  return Number.isNaN(t) ? null : t;
};

async function fetchAll(fn, filter) {
  let all = [];
  let cursor;
  do {
    const b = await fn({ filter, limit: 100, cursor });
    all = all.concat(b.items);
    cursor = b.has_more ? b.next_cursor : null;
    if (cursor) await pennylane.sleep(pennylane.RATE_LIMIT_DELAY);
  } while (cursor);
  return all;
}

async function runCardDirectReconcile() {
  const token = await pennylane.getToken();
  if (!token) return { skipped: 'Pennylane non configuré' };

  const year = new Date().getFullYear();
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;
  const dateFilter = [
    { field: 'date', operator: 'gteq', value: from },
    { field: 'date', operator: 'lteq', value: to },
  ];

  const invoices = await fetchAll(pennylane.getSupplierInvoices, dateFilter);

  const txFilter = [...dateFilter];
  const bankId = await pennylane.getSavedBankAccountId();
  if (bankId) txFilter.push({ field: 'bank_account_id', operator: 'eq', value: bankId });
  const txs = await fetchAll(pennylane.getTransactions, txFilter);
  const cardTx = txs.filter((t) => Number(t.amount || t.currency_amount) < 0);

  const tracked = await getTracked();
  const candidates = invoices.filter(
    (i) => !i.archived_at && !i.reconciled && !tracked.has(i.id)
      && day(i.date) != null && Math.abs(Number(i.currency_amount || i.amount || 0)) > 0
  );

  const usedTx = new Set();
  let matched = 0;
  let alreadyJustified = 0;
  let errors = 0;

  for (const inv of candidates) {
    const ia = Math.abs(Number(inv.currency_amount || inv.amount || 0));
    const idt = day(inv.date);
    let best = null;
    let bestDiff = 99;
    for (const t of cardTx) {
      if (usedTx.has(t.id)) continue;
      if (Math.abs(Math.abs(Number(t.amount || 0)) - ia) > 0.01) continue;
      const td = day(t.date);
      if (td == null) continue;
      const diff = (td - idt) / 86400000;
      if (diff < -1 || diff > 7) continue; // paiement le jour du ticket à +7j
      if (Math.abs(diff) < bestDiff) { best = t; bestDiff = Math.abs(diff); }
    }
    if (!best) continue;

    try {
      const mi = await pennylane.getTransactionMatchedInvoices(best.id);
      const alreadyHas = (mi.items || []).length > 0;
      if (alreadyHas) {
        // paiement déjà justifié par une autre facture -> on ne touche pas
        tracked.add(inv.id);
        usedTx.add(best.id);
        alreadyJustified++;
        continue;
      }
      await pennylane.matchTransaction(inv.id, best.id);
      tracked.add(inv.id);
      usedTx.add(best.id);
      matched++;
      await pennylane.sleep(pennylane.RATE_LIMIT_DELAY);
    } catch (e) {
      errors++;
      // pas de tracking en cas d'erreur -> nouvelle tentative au prochain run
    }
  }

  await saveTracked(tracked);
  return { candidates: candidates.length, matched, alreadyJustified, errors };
}

module.exports = { runCardDirectReconcile };
