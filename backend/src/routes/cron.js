/**
 * Endpoints déclenchés par un cron externe (GitHub Actions), authentifiés par
 * un secret partagé (header x-cron-secret), PAS par JWT.
 *
 * POST /api/cron/daily :
 *   1. (B) Rapprochement Pennylane — relie les factures (import Drive) aux
 *      transactions bancaires => la compta se fait automatiquement.
 *   2. (C) Push à chaque collaborateur de ses paiements carte sans justificatif.
 */
const express = require('express');
const { PrismaClient } = require('@prisma/client');
const pennylane = require('../services/pennylane');
const push = require('../services/push');
const { runReconcile } = require('../services/reconcileRunner');

const router = express.Router();
const prisma = new PrismaClient();

// Auth par secret partagé
router.use((req, res, next) => {
  const secret = process.env.CRON_SECRET;
  if (!secret) return res.status(503).json({ error: 'CRON_SECRET non configuré' });
  const given = req.headers['x-cron-secret'] || req.query.secret;
  if (given !== secret) return res.status(401).json({ error: 'Non autorisé' });
  next();
});

function isMatched(expenses, txAmount, txDate) {
  for (const exp of expenses) {
    const ea = Number(exp.amount);
    if (Math.abs(ea - txAmount) > 1) continue;
    let s = 0;
    if (Math.abs(ea - txAmount) < 0.02) s += 30;
    else if (Math.abs(ea - txAmount) < 0.10) s += 15;
    else s += 5;
    const dd = (txDate - new Date(exp.date_ticket).getTime()) / 86400000;
    if (dd >= -1 && dd <= 20) {
      if (dd < 2) s += 10; else if (dd < 7) s += 7; else if (dd < 15) s += 4; else s += 2;
    }
    if (s >= 25) return true;
  }
  return false;
}

async function sendMissingPush() {
  if (!push.isConfigured()) return { skipped: 'push non configuré' };
  const token = await pennylane.getToken();
  if (!token) return { skipped: 'Pennylane non configuré' };

  const cardUsers = await pennylane.getCardUsers();
  const byUser = {};
  for (const [masked, uid] of Object.entries(cardUsers)) {
    (byUser[uid] = byUser[uid] || []).push(masked);
  }
  const userIds = Object.keys(byUser);
  if (userIds.length === 0) return { users: 0, notified: 0 };

  const year = new Date().getFullYear();
  const fyStart = `${year}-01-01`;
  const fyEnd = `${year}-12-31`;
  const filter = [
    { field: 'date', operator: 'gteq', value: fyStart },
    { field: 'date', operator: 'lteq', value: fyEnd },
  ];
  const bankId = await pennylane.getSavedBankAccountId();
  if (bankId) filter.push({ field: 'bank_account_id', operator: 'eq', value: bankId });

  let allTx = [];
  let cursor;
  do {
    const batch = await pennylane.getTransactions({ filter, limit: 100, cursor });
    allTx = allTx.concat(batch.items);
    cursor = batch.has_more ? batch.next_cursor : null;
    if (cursor) await pennylane.sleep(pennylane.RATE_LIMIT_DELAY);
  } while (cursor);

  const expenseTx = allTx.filter((t) => Number(t.amount || t.currency_amount) < 0);
  const expenses = await prisma.expense.findMany({
    where: { date_ticket: { gte: new Date(fyStart) } },
    omit: { receipt_image: true },
  });

  const results = [];
  for (const uid of userIds) {
    const set = new Set(byUser[uid]);
    const myTx = expenseTx.filter((t) => {
      const ci = pennylane.cardInfo(t);
      return ci.masked && set.has(ci.masked);
    });
    let missing = 0;
    let amount = 0;
    for (const tx of myTx) {
      const a = Math.abs(Number(tx.amount || tx.currency_amount || 0));
      if (!isMatched(expenses, a, new Date(tx.date).getTime())) {
        missing++;
        amount += a;
      }
    }
    if (missing > 0) {
      const r = await push.sendToUser(parseInt(uid, 10), {
        title: 'Paiements à justifier',
        body: `${missing} paiement${missing > 1 ? 's' : ''} (${amount.toFixed(2)} €) sans justificatif. Scanne tes tickets 📷`,
        url: '/dashboard',
        tag: 'lbdp-missing',
      });
      results.push({ userId: uid, missing, sent: r.sent });
    }
  }
  return { users: userIds.length, notified: results.length, results };
}

router.post('/daily', async (req, res) => {
  const out = {};
  // 1. Rapprochement (compta) — best effort, ne bloque pas le push
  try {
    out.reconcile = await runReconcile(prisma);
    if (out.reconcile?.summary) out.reconcile = { summary: out.reconcile.summary }; // réponse compacte
  } catch (e) {
    out.reconcile = { error: e.message };
  }
  // 2. Push des paiements manquants
  try {
    out.push = await sendMissingPush();
  } catch (e) {
    out.push = { error: e.message };
  }
  res.json({ ok: true, ...out });
});

module.exports = router;
