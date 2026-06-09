const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const pennylane = require('../services/pennylane');
const missing = require('../services/missing');

const router = express.Router();

// Vue collaborateur (pas admin) : ses propres paiements carte sans justificatif.
router.use(authenticateToken);

// GET /api/my-payments/missing — lit le snapshot mutualisé (instantané) et le
// filtre sur les cartes attribuées au collaborateur connecté.
router.get('/missing', async (req, res) => {
  try {
    const userId = req.user.userId;
    const cardUsers = await pennylane.getCardUsers();
    const myCards = new Set(Object.keys(cardUsers).filter((m) => cardUsers[m] === userId));
    const empty = { total: 0, matched: 0, missing: 0, amountMissing: 0 };

    if (myCards.size === 0) {
      return res.json({ assigned: false, configured: true, cards: [], transactions: [], summary: empty });
    }

    const snap = await missing.getMissing(req.prisma);
    if (!snap.connection?.ok) {
      return res.json({ assigned: true, configured: false, cards: [], transactions: [], summary: empty });
    }

    const cards = (snap.cards || []).filter((c) => c.masked && myCards.has(c.masked));
    const transactions = (snap.transactions || [])
      .filter((t) => t.card?.masked && myCards.has(t.card.masked))
      .sort((a, b) => (a.date < b.date ? 1 : -1));
    const summary = {
      total: cards.reduce((n, c) => n + c.total, 0),
      matched: cards.reduce((n, c) => n + c.matched, 0),
      missing: cards.reduce((n, c) => n + c.missing, 0),
      amountMissing: +cards.reduce((n, c) => n + c.amountMissing, 0).toFixed(2),
    };

    res.json({ assigned: true, configured: true, cards, transactions, summary, computedAt: snap.computedAt });
  } catch (err) {
    console.error('[my-payments] missing error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
