const express = require('express');
const { z } = require('zod');
const { authenticateToken, checkAdmin } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const pennylane = require('../services/pennylane');
const { reconcile } = require('../services/reconciliation');

const router = express.Router();

// Rapprochement = vue de contrôle réservée aux admins.
router.use(authenticateToken);
router.use(checkAdmin);

function monthRange(month, year) {
  const now = new Date();
  const y = parseInt(year, 10) || now.getUTCFullYear();
  const m = (parseInt(month, 10) || (now.getUTCMonth() + 1)) - 1; // 0-indexed
  const start = new Date(Date.UTC(y, m, 1));
  const end = new Date(Date.UTC(y, m + 1, 0));
  const fmt = (d) => d.toISOString().slice(0, 10);
  return { y, m: m + 1, start, end, from: fmt(start), to: fmt(end) };
}

function addDays(date, days) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

// GET /api/reconciliation/status — état de la connexion Pennylane
router.get('/status', async (req, res) => {
  const status = await pennylane.checkConnection();
  res.json({ status });
});

// GET /api/reconciliation/cards — liste des cartes connues (intitulés éditables)
router.get('/cards', async (req, res) => {
  try {
    const cards = await req.prisma.cardMapping.findMany({ orderBy: { last4: 'asc' } });
    res.json({ cards });
  } catch (err) {
    console.error('List card mappings error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

const updateCardSchema = z.object({
  label: z.string().max(100).trim().nullable().optional(),
  scan_card_id: z.string().max(50).trim().nullable().optional(),
});

// PUT /api/reconciliation/cards/:id — modifier l'intitulé / le lien d'une carte
router.put('/cards/:id', validate(updateCardSchema), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const data = {};
    if (req.validatedBody.label !== undefined) data.label = req.validatedBody.label || null;
    if (req.validatedBody.scan_card_id !== undefined) data.scan_card_id = req.validatedBody.scan_card_id || null;

    const card = await req.prisma.cardMapping.update({ where: { id }, data });
    res.json({ card });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Carte non trouvée' });
    console.error('Update card mapping error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/reconciliation?month=&year=&tolerance= — rapprochement de la période
router.get('/', async (req, res) => {
  try {
    const connection = await pennylane.checkConnection();
    if (!connection.ok) {
      return res.json({
        connection,
        period: monthRange(req.query.month, req.query.year),
        totals: null,
        cards: [],
        orphanScans: [],
        message: connection.configured
          ? 'Connexion Pennylane impossible — vérifiez le token.'
          : 'Token Pennylane non configuré (variable PENNYLANE_API_TOKEN).',
      });
    }

    const range = monthRange(req.query.month, req.query.year);
    const toleranceDays = Math.min(parseInt(req.query.tolerance, 10) || 4, 15);

    // Transactions Pennylane du compte Pro pour la période.
    const transactions = await pennylane.fetchProTransactions({ from: range.from, to: range.to });

    // Auto-découverte : on crée une fiche carte pour tout numéro masqué inconnu.
    const seen = [...new Set(transactions.filter((t) => t.cardMasked).map((t) => t.cardMasked))];
    if (seen.length) {
      const existing = await req.prisma.cardMapping.findMany({
        where: { masked_number: { in: seen } },
        select: { masked_number: true },
      });
      const known = new Set(existing.map((c) => c.masked_number));
      const toCreate = seen.filter((m) => !known.has(m));
      if (toCreate.length) {
        await req.prisma.cardMapping.createMany({
          data: toCreate.map((m) => ({ masked_number: m, last4: m.slice(-4) })),
          skipDuplicates: true,
        });
      }
    }

    const mappings = await req.prisma.cardMapping.findMany();

    // Dépenses scannées dans une fenêtre élargie (tolérance de dates aux bords de mois).
    const expenseRows = await req.prisma.expense.findMany({
      where: {
        date_ticket: { gte: addDays(range.start, -7), lte: addDays(range.end, 7) },
      },
      include: { user: { select: { name: true, card_id: true } } },
    });
    const expenses = expenseRows.map((e) => ({
      id: e.id,
      amount: Number(e.amount),
      date_ticket: e.date_ticket,
      card_id: e.card_id,
      merchant: e.merchant,
      drive_file_url: e.drive_file_url,
      has_receipt: e.has_receipt,
      user_name: e.user?.name || null,
    }));

    const result = reconcile({ transactions, expenses, mappings, toleranceDays });

    res.json({
      connection: { ok: true, company: connection.company },
      period: { month: range.m, year: range.y, from: range.from, to: range.to },
      ...result,
    });
  } catch (err) {
    console.error('Reconciliation error:', err);
    res.status(err.code === 'AUTH' ? 502 : 500).json({ error: err.message || 'Erreur serveur' });
  }
});

module.exports = router;
