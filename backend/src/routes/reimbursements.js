/**
 * Demandes de remboursement (dépenses payées en espèces perso / note de frais).
 * Les collaborateurs les créent au scan ; les admins les gèrent (rembourser / refuser).
 */
const express = require('express');
const { authenticateToken, checkAdmin } = require('../middleware/auth');
const { PAYMENT_LABELS } = require('../services/payment');
const { generatePDF } = require('../services/pdf');
const { updateDriveFile, uploadToDrive, getRootFolderId } = require('../services/drive');

const router = express.Router();
router.use(authenticateToken);

const STATUSES = ['pending', 'reimbursed', 'rejected'];

// Régénère le justificatif PDF avec le statut de remboursement à jour et
// met à jour le fichier sur le Drive (best-effort — ne bloque pas la clôture).
async function syncReimbursementPdf(prisma, expenseId) {
  try {
    const e = await prisma.expense.findUnique({
      where: { id: expenseId },
      include: { user: { select: { name: true, card_id: true, drive_folder_id: true } } },
    });
    if (!e || !e.drive_file_id) return;

    const img = e.receipt_image ? Buffer.from(e.receipt_image) : null;
    const hasImg = img && img.length > 0;
    const pdfBuffer = await generatePDF({
      imageBuffer: hasImg ? img : null,
      imageMime: hasImg ? 'image/jpeg' : null,
      date: e.date_ticket,
      amount: Number(e.amount),
      type: e.type,
      merchant: e.merchant || '',
      description: e.description || '',
      userName: e.user.name,
      cardId: e.user.card_id,
      paymentMethod: e.payment_method,
      reimbursementStatus: e.reimbursement_status,
      reimbursedAt: e.reimbursed_at,
      isUpdate: !hasImg && e.has_receipt,
    });

    try {
      await updateDriveFile(e.drive_file_id, pdfBuffer, e.file_name);
    } catch (updateErr) {
      console.error('[reimbursements] drive update failed, recreating:', updateErr.message);
      const folderId = e.user.drive_folder_id || await getRootFolderId();
      if (folderId) {
        const r = await uploadToDrive(pdfBuffer, e.file_name, folderId);
        await prisma.expense.update({
          where: { id: expenseId },
          data: { drive_file_id: r.fileId, drive_file_url: r.webViewLink },
        });
      }
    }
  } catch (err) {
    console.error('[reimbursements] pdf sync error:', err.message);
  }
}

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

    // Met à jour le justificatif PDF sur le Drive avec le nouveau statut
    await syncReimbursementPdf(req.prisma, id);

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
