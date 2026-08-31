const express = require('express');
const { z } = require('zod');
const { authenticateToken } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { generatePDF } = require('../services/pdf');
const { updateDriveFile, uploadToDrive, downloadDriveFile, getRootFolderId } = require('../services/drive');

const router = express.Router();

// Receipt proxy — handles its own auth (supports ?token= for inline viewing)
router.get('/:id/receipt', (req, res, next) => {
  if (!req.headers['authorization'] && req.query.token) {
    req.headers['authorization'] = `Bearer ${req.query.token}`;
  }
  next();
}, authenticateToken, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'ID invalide' });
    }

    const expense = await req.prisma.expense.findUnique({
      where: { id },
      omit: { receipt_image: true },
    });

    if (!expense) {
      return res.status(404).json({ error: 'Dépense non trouvée' });
    }

    if (req.user.role !== 'admin' && expense.user_id !== req.user.userId) {
      return res.status(403).json({ error: 'Accès non autorisé' });
    }

    // Try Drive first, fall back to stored image in DB
    if (expense.drive_file_id) {
      try {
        const file = await downloadDriveFile(expense.drive_file_id);
        res.setHeader('Content-Type', file.mimeType || 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="${file.name || 'receipt.pdf'}"`);
        res.setHeader('Content-Length', file.buffer.length);
        return res.send(file.buffer);
      } catch (driveErr) {
        console.error('Receipt Drive download error, falling back to DB:', driveErr.message);
      }
    }

    // Fallback: serve stored receipt_image from database
    if (expense.has_receipt) {
      const full = await req.prisma.expense.findUnique({
        where: { id },
        select: { receipt_image: true },
      });
      if (full?.receipt_image) {
        const imgBuffer = Buffer.from(full.receipt_image);
        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Content-Disposition', `inline; filename="receipt-${id}.jpg"`);
        res.setHeader('Content-Length', imgBuffer.length);
        return res.send(imgBuffer);
      }
    }

    return res.status(404).json({ error: 'Aucun justificatif disponible' });
  } catch (err) {
    console.error('Receipt download error:', err);
    res.status(500).json({ error: 'Erreur lors du téléchargement' });
  }
});

// All other routes require authentication
router.use(authenticateToken);

// Validation schemas
const createExpenseSchema = z.object({
  date_ticket: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format de date invalide (AAAA-MM-JJ)'),
  amount: z.number().positive('Le montant doit être positif').max(9999.99, 'Montant trop élevé'),
  type: z.string().min(1).max(30).trim(),
  merchant: z.string().min(1).max(255).trim().optional(),
  description: z.string().max(500).trim().optional(),
  has_receipt: z.boolean().optional().default(true),
});

const updateExpenseSchema = z.object({
  date_ticket: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format de date invalide (AAAA-MM-JJ)').optional(),
  amount: z.number().positive('Le montant doit être positif').max(9999.99, 'Montant trop élevé').optional(),
  type: z.string().min(1).max(30).trim().optional(),
  merchant: z.string().max(255).trim().optional(),
  description: z.string().max(500).trim().optional(),
});

const MAX_PAGE_SIZE = 100;

// CSV injection protection: escape fields that could be interpreted as formulas
function escapeCsvField(value) {
  if (value == null) return '';
  const str = String(value);
  if (/^[=+\-@\t\r]/.test(str)) {
    return "'" + str;
  }
  return str.replace(/"/g, '""');
}

function parseId(raw) {
  const id = parseInt(raw, 10);
  return isNaN(id) ? null : id;
}

function parsePagination(rawPage, rawLimit) {
  const page = Math.max(parseInt(rawPage, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(rawLimit, 10) || 50, 1), MAX_PAGE_SIZE);
  return { page, limit, skip: (page - 1) * limit };
}

// GET /api/expenses — user sees own, admin sees all
router.get('/', async (req, res) => {
  try {
    const { type, month, year, q } = req.query;
    const { page, limit, skip } = parsePagination(req.query.page, req.query.limit);

    const where = {};

    // User cloisonnement: non-admin only sees own expenses
    if (req.user.role !== 'admin') {
      where.user_id = req.user.userId;
    }

    // Filters
    if (type) {
      where.type = type;
    }

    if (month && year) {
      const startDate = new Date(parseInt(year), parseInt(month) - 1, 1);
      const endDate = new Date(parseInt(year), parseInt(month), 0);
      where.date_ticket = {
        gte: startDate,
        lte: endDate,
      };
    } else if (year) {
      where.date_ticket = {
        gte: new Date(parseInt(year), 0, 1),
        lte: new Date(parseInt(year), 11, 31),
      };
    }

    // Full-text search on merchant and description
    if (q && q.trim().length > 0) {
      const search = q.trim();
      where.OR = [
        { merchant: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [expenses, total] = await Promise.all([
      req.prisma.expense.findMany({
        where,
        omit: { receipt_image: true },
        include: {
          user: {
            select: { id: true, name: true, card_id: true },
          },
        },
        orderBy: { date_ticket: 'desc' },
        skip,
        take: limit,
      }),
      req.prisma.expense.count({ where }),
    ]);

    res.json({
      expenses,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    console.error('Get expenses error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/expenses/check-duplicate — detect potential duplicate before submission
router.get('/check-duplicate', async (req, res) => {
  try {
    const { amount, date_ticket, merchant } = req.query;
    if (!amount || !date_ticket) {
      return res.json({ duplicate: null });
    }

    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount)) {
      return res.json({ duplicate: null });
    }

    const targetDate = new Date(date_ticket);
    const dayBefore = new Date(targetDate);
    dayBefore.setDate(dayBefore.getDate() - 1);
    const dayAfter = new Date(targetDate);
    dayAfter.setDate(dayAfter.getDate() + 1);

    const where = {
      user_id: req.user.userId,
      amount: { gte: parsedAmount - 0.01, lte: parsedAmount + 0.01 },
      date_ticket: { gte: dayBefore, lte: dayAfter },
    };

    if (merchant && merchant.trim()) {
      where.merchant = { contains: merchant.trim(), mode: 'insensitive' };
    }

    const match = await req.prisma.expense.findFirst({
      where,
      omit: { receipt_image: true },
      orderBy: { created_at: 'desc' },
    });

    res.json({ duplicate: match || null });
  } catch (err) {
    console.error('Check duplicate error:', err);
    res.json({ duplicate: null });
  }
});

// GET /api/expenses/stats — monthly stats
router.get('/stats', async (req, res) => {
  try {
    const where = {};
    if (req.user.role !== 'admin') {
      where.user_id = req.user.userId;
    }

    // Current month stats
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    // Mois précédent
    const startOfPrevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const endOfPrevMonth = new Date(now.getFullYear(), now.getMonth(), 0);

    const monthWhere = {
      ...where,
      date_ticket: { gte: startOfMonth, lte: endOfMonth },
    };
    const prevMonthWhere = {
      ...where,
      date_ticket: { gte: startOfPrevMonth, lte: endOfPrevMonth },
    };

    const [monthExpenses, totalCount, typeStats, prevMonthExpenses, prevTypeStats] = await Promise.all([
      req.prisma.expense.aggregate({
        where: monthWhere,
        _sum: { amount: true },
        _count: true,
      }),
      req.prisma.expense.count({ where }),
      req.prisma.expense.groupBy({
        by: ['type'],
        where: monthWhere,
        _sum: { amount: true },
        _count: true,
      }),
      req.prisma.expense.aggregate({
        where: prevMonthWhere,
        _sum: { amount: true },
        _count: true,
      }),
      req.prisma.expense.groupBy({
        by: ['type'],
        where: prevMonthWhere,
        _sum: { amount: true },
        _count: true,
      }),
    ]);

    // Libellé du mois précédent (ex. "juillet")
    const prevMonthLabel = startOfPrevMonth.toLocaleDateString('fr-FR', { month: 'long' });

    res.json({
      month: {
        total: monthExpenses._sum.amount || 0,
        count: monthExpenses._count,
      },
      prevMonth: {
        total: prevMonthExpenses._sum.amount || 0,
        count: prevMonthExpenses._count,
        label: prevMonthLabel,
      },
      allTime: { count: totalCount },
      byType: typeStats.map(t => ({
        type: t.type,
        total: t._sum.amount || 0,
        count: t._count,
      })),
      prevByType: prevTypeStats.map(t => ({
        type: t.type,
        total: t._sum.amount || 0,
        count: t._count,
      })),
    });
  } catch (err) {
    console.error('Stats error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/expenses/recent — last 3 expenses for user
router.get('/recent', async (req, res) => {
  try {
    const expenses = await req.prisma.expense.findMany({
      where: { user_id: req.user.userId },
      omit: { receipt_image: true },
      orderBy: { created_at: 'desc' },
      take: 3,
      include: {
        user: {
          select: { id: true, name: true },
        },
      },
    });

    res.json({ expenses });
  } catch (err) {
    console.error('Recent expenses error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/expenses/stats/advanced — monthly trends + type breakdown
// Supports ?from=YYYY-MM-DD&to=YYYY-MM-DD for flexible date ranges
// Also supports ?compareFrom=YYYY-MM-DD&compareTo=YYYY-MM-DD for N-1 comparison
router.get('/stats/advanced', async (req, res) => {
  try {
    const where = {};
    if (req.user.role !== 'admin') {
      where.user_id = req.user.userId;
    } else if (req.query.userId) {
      const userId = parseInt(req.query.userId, 10);
      if (!isNaN(userId)) where.user_id = userId;
    }
    // Filtre optionnel par mode de paiement (défaut : toutes les dépenses)
    const pm = req.query.payment_method;
    if (pm && ['carte', 'cheque', 'virement', 'caisse', 'especes', 'note_frais'].includes(pm)) {
      where.payment_method = pm;
    }

    const now = new Date();
    let fromDate, toDate;
    if (req.query.from && req.query.to) {
      fromDate = new Date(req.query.from);
      toDate = new Date(req.query.to);
    } else {
      fromDate = new Date(now.getFullYear(), now.getMonth() - 5, 1);
      toDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    }

    const expenses = await req.prisma.expense.findMany({
      where: {
        ...where,
        date_ticket: { gte: fromDate, lte: toDate },
      },
      select: {
        amount: true,
        type: true,
        date_ticket: true,
        has_receipt: true,
        upload_status: true,
        user_id: true,
        user: { select: { name: true } },
      },
      orderBy: { date_ticket: 'asc' },
    });

    // Build monthly breakdown for every month in the range
    const monthlyMap = {};
    const startMonth = new Date(fromDate.getFullYear(), fromDate.getMonth(), 1);
    const endMonth = new Date(toDate.getFullYear(), toDate.getMonth(), 1);
    for (let d = new Date(startMonth); d <= endMonth; d.setMonth(d.getMonth() + 1)) {
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      monthlyMap[key] = { month: key, total: 0, count: 0, byType: {} };
    }

    let grandTotal = 0;
    const typeTotals = {};
    let withReceipt = 0;
    let withoutReceipt = 0;
    const userMap = {}; // user_id -> { userId, name, total, count, byType }

    for (const exp of expenses) {
      const d = new Date(exp.date_ticket);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const amt = Number(exp.amount);

      if (monthlyMap[key]) {
        monthlyMap[key].total += amt;
        monthlyMap[key].count++;
        monthlyMap[key].byType[exp.type] = (monthlyMap[key].byType[exp.type] || 0) + amt;
      }

      grandTotal += amt;
      typeTotals[exp.type] = (typeTotals[exp.type] || 0) + amt;

      if (exp.has_receipt) withReceipt++;
      else withoutReceipt++;

      // Répartition par collaborateur (× catégorie)
      const uid = exp.user_id;
      if (!userMap[uid]) {
        userMap[uid] = { userId: uid, name: exp.user?.name || `#${uid}`, total: 0, count: 0, byType: {} };
      }
      userMap[uid].total += amt;
      userMap[uid].count++;
      userMap[uid].byType[exp.type] = (userMap[uid].byType[exp.type] || 0) + amt;
    }

    const byUser = Object.values(userMap).sort((a, b) => b.total - a.total);

    const monthly = Object.values(monthlyMap);
    const activeMonths = monthly.filter(m => m.count > 0);
    const avgMonthly = activeMonths.length > 0
      ? monthly.reduce((s, m) => s + m.total, 0) / activeMonths.length
      : 0;

    // Optional: comparison period (N-1)
    let comparison = null;
    if (req.query.compareFrom && req.query.compareTo) {
      const cFrom = new Date(req.query.compareFrom);
      const cTo = new Date(req.query.compareTo);
      const compExpenses = await req.prisma.expense.findMany({
        where: {
          ...where,
          date_ticket: { gte: cFrom, lte: cTo },
        },
        select: { amount: true, type: true, date_ticket: true },
        orderBy: { date_ticket: 'asc' },
      });

      let compTotal = 0;
      const compTypeTotals = {};
      const compMonthlyMap = {};
      const cStartMonth = new Date(cFrom.getFullYear(), cFrom.getMonth(), 1);
      const cEndMonth = new Date(cTo.getFullYear(), cTo.getMonth(), 1);
      for (let d = new Date(cStartMonth); d <= cEndMonth; d.setMonth(d.getMonth() + 1)) {
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        compMonthlyMap[key] = { month: key, total: 0, count: 0 };
      }

      for (const exp of compExpenses) {
        const d = new Date(exp.date_ticket);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        const amt = Number(exp.amount);
        compTotal += amt;
        compTypeTotals[exp.type] = (compTypeTotals[exp.type] || 0) + amt;
        if (compMonthlyMap[key]) {
          compMonthlyMap[key].total += amt;
          compMonthlyMap[key].count++;
        }
      }

      comparison = {
        grandTotal: compTotal,
        totalExpenses: compExpenses.length,
        typeTotals: Object.entries(compTypeTotals).map(([type, total]) => ({ type, total })),
        monthly: Object.values(compMonthlyMap),
      };
    }

    res.json({
      monthly,
      typeTotals: Object.entries(typeTotals).map(([type, total]) => ({ type, total })),
      byUser,
      summary: {
        grandTotal,
        totalExpenses: expenses.length,
        avgMonthly: Math.round(avgMonthly * 100) / 100,
        activeMonths: activeMonths.length,
        withReceipt,
        withoutReceipt,
      },
      comparison,
      range: { from: fromDate.toISOString().slice(0, 10), to: toDate.toISOString().slice(0, 10) },
    });
  } catch (err) {
    console.error('Advanced stats error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/expenses
router.post('/', validate(createExpenseSchema), async (req, res) => {
  try {
    const data = req.validatedBody;

    const user = await req.prisma.user.findUnique({
      where: { id: req.user.userId },
    });

    const expense = await req.prisma.expense.create({
      data: {
        user_id: req.user.userId,
        card_id: user.card_id,
        date_ticket: new Date(data.date_ticket),
        amount: data.amount,
        type: data.type,
        merchant: data.merchant || null,
        description: data.description || null,
        has_receipt: data.has_receipt !== undefined ? data.has_receipt : true,
        upload_status: 'pending',
      },
      include: {
        user: {
          select: { id: true, name: true },
        },
      },
    });

    res.status(201).json({ expense });
  } catch (err) {
    console.error('Create expense error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/expenses/:id — update expense and regenerate Drive PDF
router.put('/:id', validate(updateExpenseSchema), async (req, res) => {
  try {
    const expenseId = parseId(req.params.id);
    if (!expenseId) {
      return res.status(400).json({ error: 'ID invalide' });
    }

    // Check ownership
    const existing = await req.prisma.expense.findUnique({
      where: { id: expenseId },
    });

    if (!existing) {
      return res.status(404).json({ error: 'Dépense non trouvée' });
    }

    if (req.user.role !== 'admin' && existing.user_id !== req.user.userId) {
      return res.status(403).json({ error: 'Accès non autorisé' });
    }

    const data = req.validatedBody;
    const updateData = {};

    if (data.date_ticket !== undefined) updateData.date_ticket = new Date(data.date_ticket);
    if (data.amount !== undefined) updateData.amount = data.amount;
    if (data.type !== undefined) updateData.type = data.type;
    if (data.merchant !== undefined) updateData.merchant = data.merchant || null;
    if (data.description !== undefined) updateData.description = data.description || null;

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ error: 'Aucun champ à modifier' });
    }

    const expense = await req.prisma.expense.update({
      where: { id: expenseId },
      data: updateData,
      omit: { receipt_image: true },
      include: {
        user: {
          select: { id: true, name: true, card_id: true, drive_folder_id: true },
        },
      },
    });

    // Regenerate PDF and update Drive if file was previously uploaded
    if (existing.drive_file_id) {
      try {
        const ticketDate = new Date(expense.date_ticket);
        const userName = expense.user.name.split(' ')[0];
        const prefix = existing.has_receipt ? 'ticket' : 'sans-ticket';
        const fileName = `${prefix}_${ticketDate.toISOString().slice(0, 10)}_${expense.type}_${Number(expense.amount).toFixed(2)}EUR_${userName}.pdf`;

        // Retrieve stored receipt image for PDF regeneration
        // Prisma Bytes may return Uint8Array — ensure proper Node.js Buffer
        const rawImage = existing.receipt_image;
        const storedImage = rawImage ? Buffer.from(rawImage) : null;
        const hasStoredImage = storedImage && storedImage.length > 0;

        console.log(`[expense] PDF regen #${expenseId}: hasStoredImage=${hasStoredImage}, bufferSize=${storedImage?.length || 0}`);

        const pdfBuffer = await generatePDF({
          imageBuffer: hasStoredImage ? storedImage : null,
          imageMime: hasStoredImage ? 'image/jpeg' : null,
          date: ticketDate,
          amount: Number(expense.amount),
          type: expense.type,
          merchant: expense.merchant || '',
          description: expense.description || '',
          userName: expense.user.name,
          cardId: expense.user.card_id,
          paymentMethod: expense.payment_method,
          isUpdate: !hasStoredImage && existing.has_receipt,
        });

        let driveResult;
        try {
          driveResult = await updateDriveFile(existing.drive_file_id, pdfBuffer, fileName);
        } catch (updateErr) {
          // File may have been deleted on Drive — try creating a new one
          console.error('[drive] Update failed, creating new file:', updateErr.message);
          const folderId = expense.user.drive_folder_id || await getRootFolderId();
          if (folderId) {
            driveResult = await uploadToDrive(pdfBuffer, fileName, folderId);
          }
        }

        if (driveResult) {
          await req.prisma.expense.update({
            where: { id: expenseId },
            data: {
              file_name: fileName,
              drive_file_id: driveResult.fileId,
              drive_file_url: driveResult.webViewLink,
            },
          });
          expense.file_name = fileName;
          expense.drive_file_id = driveResult.fileId;
          expense.drive_file_url = driveResult.webViewLink;
        }

        console.log(`[expense] Updated expense #${expenseId} and Drive file`);
      } catch (driveErr) {
        console.error('[drive] Error updating Drive file:', driveErr.message);
        // Don't fail the whole update if Drive update fails
      }
    }

    res.json({ expense });
  } catch (err) {
    console.error('Update expense error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /api/expenses/:id — admin only
router.delete('/:id', async (req, res) => {
  try {
    const expenseId = parseId(req.params.id);
    if (!expenseId) {
      return res.status(400).json({ error: 'ID invalide' });
    }

    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Suppression réservée aux administrateurs' });
    }

    const existing = await req.prisma.expense.findUnique({
      where: { id: expenseId },
      omit: { receipt_image: true },
    });

    if (!existing) {
      return res.status(404).json({ error: 'Dépense non trouvée' });
    }

    // Delete file from Google Drive if it exists
    if (existing.drive_file_id) {
      try {
        const { deleteDriveFile } = require('../services/drive');
        await deleteDriveFile(existing.drive_file_id);
        console.log(`[drive] Deleted file ${existing.drive_file_id} for expense ${expenseId}`);
      } catch (driveErr) {
        console.error('[drive] Error deleting file (continuing with DB delete):', driveErr.message);
      }
    }

    await req.prisma.expense.delete({
      where: { id: expenseId },
    });

    res.json({ success: true, message: 'Dépense supprimée' });
  } catch (err) {
    console.error('Delete expense error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/expenses/export/csv — CSV export
router.get('/export/csv', async (req, res) => {
  try {
    const where = {};
    if (req.user.role !== 'admin') {
      where.user_id = req.user.userId;
    }

    const { month, year, type } = req.query;
    if (type) {
      where.type = type;
    }
    if (month && year) {
      where.date_ticket = {
        gte: new Date(parseInt(year), parseInt(month) - 1, 1),
        lte: new Date(parseInt(year), parseInt(month), 0),
      };
    }

    const expenses = await req.prisma.expense.findMany({
      where,
      omit: { receipt_image: true },
      include: {
        user: { select: { name: true, card_id: true } },
      },
      orderBy: { date_ticket: 'desc' },
    });

    const header = 'Date,Collaborateur,Carte,Type,Commercant,Montant (EUR),Description,Justificatif,Lien Drive\n';
    const rows = expenses.map(e => {
      const date = new Date(e.date_ticket).toLocaleDateString('fr-FR');
      return [
        escapeCsvField(date),
        `"${escapeCsvField(e.user.name)}"`,
        `"${escapeCsvField(e.card_id)}"`,
        `"${escapeCsvField(e.type)}"`,
        `"${escapeCsvField(e.merchant)}"`,
        e.amount,
        `"${escapeCsvField(e.description)}"`,
        e.has_receipt ? 'Oui' : 'Non',
        `"${escapeCsvField(e.drive_file_url)}"`,
      ].join(',');
    }).join('\n');

    const bom = '\uFEFF';
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=notes-de-frais-${new Date().toISOString().slice(0, 10)}.csv`);
    res.send(bom + header + rows);
  } catch (err) {
    console.error('Export CSV error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
