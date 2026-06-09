/**
 * Calcul centralisé des paiements carte sans justificatif (exercice fiscal courant).
 *
 * Un paiement est "justifié" s'il a un ticket scan-docu OU une facture Pennylane
 * (montant + date). Le résultat (snapshot) est mis en cache dans Setting
 * "missing_snapshot" : le cron le recalcule (toutes les heures), et les pages
 * (accueil collaborateur, admin) le lisent instantanément au lieu de relancer
 * un gros appel Pennylane à chaque ouverture.
 */
const pennylane = require('./pennylane');
const { fiscalYear } = require('./fiscalYear');
const match = require('./match');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const SNAP_KEY = 'missing_snapshot';
const SNAP_TTL_MS = 90 * 60 * 1000; // 90 min

const dms = (s) => {
  const t = Date.parse(String(s).slice(0, 10));
  return Number.isNaN(t) ? null : t;
};

async function paginate(fn, filter) {
  let all = [], cursor;
  do {
    const b = await fn({ filter, limit: 100, cursor });
    all = all.concat(b.items);
    cursor = b.has_more ? b.next_cursor : null;
    if (cursor) await pennylane.sleep(pennylane.RATE_LIMIT_DELAY);
  } while (cursor);
  return all;
}

async function computeMissing(db) {
  const fy = fiscalYear();
  const base = { fiscalYear: fy, computedAt: new Date().toISOString() };

  const token = await pennylane.getToken();
  const cardLabels = await pennylane.getCardLabels();
  const cardUsers = await pennylane.getCardUsers();
  if (!token) {
    return { ...base, connection: { ok: false, configured: false }, cards: [], transactions: [],
      summary: { totalBankTransactions: 0, matched: 0, unmatched: 0, totalExpenses: 0 } };
  }

  const dateRange = [
    { field: 'date', operator: 'gteq', value: fy.from },
    { field: 'date', operator: 'lteq', value: fy.to },
  ];
  const txFilter = [...dateRange];
  const bankId = await pennylane.getSavedBankAccountId();
  if (bankId) txFilter.push({ field: 'bank_account_id', operator: 'eq', value: bankId });

  const allTx = await paginate(pennylane.getTransactions, txFilter);
  const expenseTx = allTx.filter((t) => Number(t.amount || t.currency_amount) < 0);

  const allInv = await paginate(pennylane.getSupplierInvoices, dateRange);
  const invoices = allInv
    .map((i) => ({ amount: Math.abs(Number(i.currency_amount || i.amount || 0)), date: i.date }))
    .filter((i) => i.amount > 0 && i.date);

  const expRows = await db.expense.findMany({
    where: { date_ticket: { gte: new Date(fy.from) } },
    omit: { receipt_image: true },
  });
  const expenses = expRows.map((e) => ({ amount: Number(e.amount), dateMs: dms(e.date_ticket) }));

  function hasExpense(a, tdms) {
    for (const e of expenses) {
      if (match.expenseScore(e.amount, e.dateMs, a, tdms) >= 25) return true;
    }
    return false;
  }

  const cardsMap = new Map();
  const unmatched = [];
  for (const tx of expenseTx) {
    const a = Math.abs(Number(tx.amount || tx.currency_amount || 0));
    const tdms = dms(tx.date);
    const matched = hasExpense(a, tdms) || pennylane.justifiedByInvoice(invoices, a, tx.date);
    const ci = pennylane.cardInfo(tx);
    const key = ci.masked || 'unknown';
    if (!cardsMap.has(key)) {
      cardsMap.set(key, {
        masked: ci.masked, last4: ci.last4, employee: ci.employee,
        label: ci.masked ? (cardLabels[ci.masked] || null) : null,
        userId: ci.masked ? (cardUsers[ci.masked] || null) : null,
        total: 0, matched: 0, missing: 0, amountMissing: 0,
      });
    }
    const b = cardsMap.get(key);
    b.total += 1;
    if (matched) b.matched += 1;
    else {
      b.missing += 1;
      b.amountMissing = +(b.amountMissing + a).toFixed(2);
      unmatched.push({ transactionId: tx.id, label: tx.label, amount: a, date: tx.date,
        card: { masked: ci.masked, last4: ci.last4, label: b.label } });
    }
  }
  const cards = [...cardsMap.values()].sort((x, y) => y.missing - x.missing);
  const matched = cards.reduce((n, c) => n + c.matched, 0);

  return { ...base, connection: { ok: true }, cards, transactions: unmatched,
    summary: { totalBankTransactions: expenseTx.length, matched, unmatched: unmatched.length, totalExpenses: expRows.length } };
}

async function buildAndStore(db) {
  const snap = await computeMissing(db);
  try {
    await prisma.setting.upsert({
      where: { key: SNAP_KEY },
      update: { value: JSON.stringify(snap) },
      create: { key: SNAP_KEY, value: JSON.stringify(snap) },
    });
  } catch (e) { console.error('[missing] store snapshot error:', e.message); }
  return snap;
}

async function readSnapshot() {
  try {
    const r = await prisma.setting.findUnique({ where: { key: SNAP_KEY } });
    return r?.value ? JSON.parse(r.value) : null;
  } catch { return null; }
}

// Lecture rapide : snapshot récent si dispo, sinon (re)calcul + stockage.
async function getMissing(db, { refresh = false } = {}) {
  if (!refresh) {
    const snap = await readSnapshot();
    if (snap?.computedAt && (Date.now() - Date.parse(snap.computedAt) < SNAP_TTL_MS)) {
      return { ...snap, cached: true };
    }
  }
  return { ...(await buildAndStore(db)), cached: false };
}

module.exports = { computeMissing, buildAndStore, readSnapshot, getMissing };
