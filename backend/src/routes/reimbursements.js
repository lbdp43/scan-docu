/**
 * Demandes de remboursement (dépenses payées en espèces perso / note de frais).
 * Les collaborateurs les créent au scan ; les admins les gèrent (rembourser / refuser).
 */
const express = require('express');
const { authenticateToken, checkAdmin } = require('../middleware/auth');
const { PAYMENT_LABELS } = require('../services/payment');

const router = express.Router();
router.use(authenticateToken);

const STATUSES = ['pending', 'reimbursed', 'rejected'];

// GET /api/reimbursements/mine — les demandes du collaborateur connecté
router.get('/mine', async (req, res) => {
  try {
    const rows = await req.prisma.expense.findMany({
      where: { user_id: req.user.userId, reimbursement_status: { not: null } },
      omit: { receipt_image: true },
      orderBy: { created_at: 'desc' },
    });
    res.json({ requests: rows.map(fmt) });
  } catch (err) {
    console.error('[reimbursements] mine error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- Admin ---
router.use(checkAdmin);

// GET /api/reimbursements?status=pending — liste + compteurs
router.get('/', async (req, res) => {
  try {
    const status = STATUSES.includes(req.query.status) ? req.query.status : null;
    const where = status
      ? { reimbursement_status: status }
      : { reimbursement_status: { not: null } };

    const rows = await req.prisma.expense.findMany({
      where,
      omit: { receipt_image: true },
      include: { user: { select: { id: true, name: true } } },
      orderBy: [{ reimbursement_status: 'asc' }, { created_at: 'desc' }],
    });

    const counts = await req.prisma.expense.groupBy({
      by: ['reimbursement_status'],
      where: { reimbursement_status: { not: null } },
      _count: { _all: true },
    });
    const summary = { pending: 0, reimbursed: 0, rejected: 0 };
    for (const c of counts) {
      if (c.reimbursement_status in summary) summary[c.reimbursement_status] = c._count._all;
    }

    res.json({ requests: rows.map(fmt), summary });
  } catch (err) {
    console.error('[reimbursements] list error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/reimbursements/count — compteur des demandes en attente (badge)
router.get('/count', async (req, res) => {
  try {
    const pending = await req.prisma.expense.count({ where: { reimbursement_status: 'pending' } });
    res.json({ pending });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/reimbursements/:id — changer le statut (rembourser / refuser / rouvrir)
router.put('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'ID invalide' });

    const status = req.body.status;
    if (!STATUSES.includes(status)) {
      return res.status(400).json({ error: 'Statut invalide' });
    }

    const existing = await req.prisma.expense.findUnique({ where: { id } });
    if (!existing || !existing.reimbursement_status) {
      return res.status(404).json({ error: 'Demande introuvable' });
    }

    const updated = await req.prisma.expense.update({
      where: { id },
      data: {
        reimbursement_status: status,
        reimbursed_at: status === 'reimbursed' ? new Date() : null,
        reimbursed_by: status === 'reimbursed' ? req.user.userId : null,
      },
      omit: { receipt_image: true },
      include: { user: { select: { id: true, name: true } } },
    });

    res.json({ request: fmt(updated) });
  } catch (err) {
    console.error('[reimbursements] update error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

function fmt(e) {
  return {
    id: e.id,
    userId: e.user_id,
    userName: e.user?.name || null,
    amount: Number(e.amount),
    date: e.date_ticket,
    type: e.type,
    merchant: e.merchant,
    description: e.description,
    paymentMethod: e.payment_method,
    paymentLabel: PAYMENT_LABELS[e.payment_method] || e.payment_method,
    status: e.reimbursement_status,
    reimbursedAt: e.reimbursed_at,
    driveUrl: e.drive_file_url,
    fileName: e.file_name,
    createdAt: e.created_at,
  };
}

module.exports = router;
