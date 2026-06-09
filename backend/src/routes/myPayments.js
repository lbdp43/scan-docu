const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const pennylane = require('../services/pennylane');

const router = express.Router();

// Vue collaborateur (pas admin) : ses propres paiements carte sans justificatif.
router.use(authenticateToken);

// Score de correspondance transaction <-> dépense (même logique que /pennylane/missing)
function matchScore(exp, txAmount, txDate) {
  const expAmount = Number(exp.amount);
  if (Math.abs(expAmount - txAmount) > 1) return 0;
  let score = 0;
  if (Math.abs(expAmount - txAmount) < 0.02) score += 30;
  else if (Math.abs(expAmount - txAmount) < 0.10) score += 15;
  else score += 5;
  const daysDiff = (txDate - new Date(exp.date_ticket).getTime()) / (1000 * 60 * 60 * 24);
  if (daysDiff >= -1 && daysDiff <= 20) {
    if (daysDiff < 2) score += 10;
    else if (daysDiff < 7) score += 7;
    else if (daysDiff < 15) score += 4;
    else score += 2;
  }
  return score;
}

// GET /api/my-payments/missing — paiements des cartes du collaborateur sans ticket scanné
router.get('/missing', async (req, res) => {
  try {
    const userId = req.user.userId;
    const cardUsers = await pennylane.getCardUsers(); // { masked: userId }
    const myCards = Object.keys(cardUsers).filter((m) => cardUsers[m] === userId);
    const cardLabels = await pennylane.getCardLabels();

    const empty = { total: 0, matched: 0, missing: 0, amountMissing: 0 };

    if (myCards.length === 0) {
      return res.json({ assigned: false, configured: true, transactions: [], cards: [], summary: empty });
    }

    const token = await pennylane.getToken();
    if (!token) {
      return res.json({ assigned: true, configured: false, transactions: [], cards: [], summary: empty });
    }

    const year = new Date().getFullYear();
    const fyStart = `${year}-01-01`;
    const fyEnd = `${year}-12-31`;
    const filter = [
      { field: 'date', operator: 'gteq', value: fyStart },
      { field: 'date', operator: 'lteq', value: fyEnd },
    ];
    const savedBankId = await pennylane.getSavedBankAccountId();
    if (savedBankId) filter.push({ field: 'bank_account_id', operator: 'eq', value: savedBankId });

    // Toutes les transactions de l'exercice (paginées)
    let allTx = [];
    let cursor;
    do {
      const batch = await pennylane.getTransactions({ filter, limit: 100, cursor });
      allTx = allTx.concat(batch.items);
      cursor = batch.has_more ? batch.next_cursor : null;
      if (cursor) await pennylane.sleep(pennylane.RATE_LIMIT_DELAY);
    } while (cursor);

    const mySet = new Set(myCards);
    const myTx = allTx
      .filter((t) => Number(t.amount || t.currency_amount) < 0)
      .filter((t) => {
        const ci = pennylane.cardInfo(t);
        return ci.masked && mySet.has(ci.masked);
      });

    // On compare à TOUTES les dépenses (un ticket de n'importe qui justifie le paiement)
    const expenses = await req.prisma.expense.findMany({
      where: { date_ticket: { gte: new Date(fyStart) } },
      omit: { receipt_image: true },
    });

    const results = [];
    for (const tx of myTx) {
      const txAmount = Math.abs(Number(tx.amount || tx.currency_amount || 0));
      const txDate = new Date(tx.date).getTime();
      let best = 0;
      for (const exp of expenses) {
        const s = matchScore(exp, txAmount, txDate);
        if (s > best) best = s;
      }
      const matched = best >= 25;
      const ci = pennylane.cardInfo(tx);
      results.push({
        transactionId: tx.id,
        label: tx.label,
        amount: txAmount,
        date: tx.date,
        matched,
        card: {
          masked: ci.masked,
          last4: ci.last4,
          label: ci.masked ? (cardLabels[ci.masked] || null) : null,
        },
      });
    }

    const unmatched = results.filter((r) => !r.matched);
    const amountMissing = +unmatched.reduce((a, r) => a + r.amount, 0).toFixed(2);

    // Récap par carte du collaborateur
    const cards = myCards.map((m) => ({
      masked: m,
      last4: m.slice(-4),
      label: cardLabels[m] || null,
    }));

    res.json({
      assigned: true,
      configured: true,
      cards,
      transactions: unmatched.sort((a, b) => (a.date < b.date ? 1 : -1)),
      summary: {
        total: results.length,
        matched: results.filter((r) => r.matched).length,
        missing: unmatched.length,
        amountMissing,
      },
    });
  } catch (err) {
    console.error('[my-payments] missing error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
