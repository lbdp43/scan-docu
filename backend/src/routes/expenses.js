const express = require('express');
const { z } = require('zod');
const { authenticateToken } = require('../middleware/auth');
const { validate } = require('../middleware/validate');

const router = express.Router();

// All routes require authentication
router.use(authenticateToken);

// Validation schemas
const createExpenseSchema = z.object({
  date_ticket: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format de date invalide (AAAA-MM-JJ)'),
  amount: z.number().positive('Le montant doit être positif').max(9999.99, 'Montant trop élevé'),
  type: z.enum(['carburant', 'repas', 'peage', 'autre']),
  merchant: z.string().min(1).max(255).trim().optional(),
  description: z.string().max(500).trim().optional(),
  has_receipt: z.boolean().optional().default(true),
  drive_file_id: z.string().optional(),
  drive_file_url: z.string().optional(),
  file_name: z.string().optional(),
  upload_status: z.string().optional(),
});

// GET /api/expenses — user sees own, admin sees all
router.get('/', async (req, res) => {
  try {
    const { type, month, year, page = 1, limit = 50 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = {};

    // User cloisonnement: non-admin only sees own expenses
    if (req.user.role !== 'admin') {
      where.user_id = req.user.userId;
    }

    // Filters
    if (type && ['carburant', 'repas', 'peage', 'autre'].includes(type)) {
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

    const [expenses, total] = await Promise.all([
      req.prisma.expense.findMany({
        where,
        include: {
          user: {
            select: { id: true, name: true, card_id: true },
          },
        },
        orderBy: { date_ticket: 'desc' },
        skip,
        take: parseInt(limit),
      }),
      req.prisma.expense.count({ where }),
    ]);

    res.json({
      expenses,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (err) {
    console.error('Get expenses error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
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

    const monthWhere = {
      ...where,
      date_ticket: { gte: startOfMonth, lte: endOfMonth },
    };

    const [monthExpenses, totalCount, typeStats] = await Promise.all([
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
    ]);

    res.json({
      month: {
        total: monthExpenses._sum.amount || 0,
        count: monthExpenses._count,
      },
      allTime: { count: totalCount },
      byType: typeStats.map(t => ({
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

// GET /api/expenses/recent — last 5 expenses for user
router.get('/recent', async (req, res) => {
  try {
    const expenses = await req.prisma.expense.findMany({
      where: { user_id: req.user.userId },
      orderBy: { created_at: 'desc' },
      take: 5,
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
        drive_file_id: data.drive_file_id || null,
        drive_file_url: data.drive_file_url || null,
        file_name: data.file_name || null,
        upload_status: data.upload_status || 'pending',
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

// PUT /api/expenses/:id
router.put('/:id', async (req, res) => {
  try {
    const expenseId = parseInt(req.params.id);

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

    const updateData = {};
    const allowedFields = ['date_ticket', 'amount', 'type', 'merchant', 'description', 'drive_file_id', 'drive_file_url', 'file_name', 'upload_status'];

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        if (field === 'date_ticket') {
          updateData[field] = new Date(req.body[field]);
        } else {
          updateData[field] = req.body[field];
        }
      }
    }

    const expense = await req.prisma.expense.update({
      where: { id: expenseId },
      data: updateData,
    });

    res.json({ expense });
  } catch (err) {
    console.error('Update expense error:', err);
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
    if (type) where.type = type;
    if (month && year) {
      where.date_ticket = {
        gte: new Date(parseInt(year), parseInt(month) - 1, 1),
        lte: new Date(parseInt(year), parseInt(month), 0),
      };
    }

    const expenses = await req.prisma.expense.findMany({
      where,
      include: {
        user: { select: { name: true, card_id: true } },
      },
      orderBy: { date_ticket: 'desc' },
    });

    const header = 'Date,Collaborateur,Carte,Type,Commerçant,Montant (€),Description,Justificatif,Lien Drive\n';
    const rows = expenses.map(e => {
      const date = new Date(e.date_ticket).toLocaleDateString('fr-FR');
      return `${date},"${e.user.name}","${e.card_id || ''}","${e.type}","${e.merchant || ''}",${e.amount},"${e.description || ''}",${e.has_receipt ? 'Oui' : 'Non'},"${e.drive_file_url || ''}"`;
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
