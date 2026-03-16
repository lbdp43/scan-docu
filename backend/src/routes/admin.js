const express = require('express');
const bcrypt = require('bcrypt');
const { z } = require('zod');
const { authenticateToken, checkAdmin } = require('../middleware/auth');
const { validate } = require('../middleware/validate');

const router = express.Router();

// All admin routes require auth + admin role
router.use(authenticateToken);
router.use(checkAdmin);

// Validation schemas
const createUserSchema = z.object({
  email: z.string().email('Email invalide').toLowerCase().trim(),
  password: z.string().min(8, 'Minimum 8 caractères').max(128),
  name: z.string().min(1, 'Nom requis').max(100).trim(),
  role: z.enum(['admin', 'user']).optional().default('user'),
  card_id: z.string().max(50).optional(),
  drive_folder_id: z.string().optional(),
});

const updateUserSchema = z.object({
  email: z.string().email().toLowerCase().trim().optional(),
  name: z.string().min(1).max(100).trim().optional(),
  role: z.enum(['admin', 'user']).optional(),
  card_id: z.string().max(50).optional().nullable(),
  drive_folder_id: z.string().optional().nullable(),
  is_active: z.boolean().optional(),
});

// GET /api/admin/users — List all users
router.get('/users', async (req, res) => {
  try {
    const users = await req.prisma.user.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        card_id: true,
        drive_folder_id: true,
        is_active: true,
        created_at: true,
        _count: { select: { expenses: true } },
      },
      orderBy: { name: 'asc' },
    });

    res.json({ users });
  } catch (err) {
    console.error('List users error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/admin/users — Create user
router.post('/users', validate(createUserSchema), async (req, res) => {
  try {
    const data = req.validatedBody;

    const existing = await req.prisma.user.findUnique({
      where: { email: data.email },
    });
    if (existing) {
      return res.status(409).json({ error: 'Un compte avec cet email existe déjà' });
    }

    const password_hash = await bcrypt.hash(data.password, 12);

    const user = await req.prisma.user.create({
      data: {
        email: data.email,
        password_hash,
        name: data.name,
        role: data.role,
        card_id: data.card_id || null,
        drive_folder_id: data.drive_folder_id || null,
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        card_id: true,
        drive_folder_id: true,
        is_active: true,
        created_at: true,
      },
    });

    res.status(201).json({ user });
  } catch (err) {
    console.error('Create user error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/admin/users/:id — Update user
router.put('/users/:id', validate(updateUserSchema), async (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);
    if (isNaN(userId)) return res.status(400).json({ error: 'ID invalide' });
    const data = req.validatedBody;

    const user = await req.prisma.user.update({
      where: { id: userId },
      data,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        card_id: true,
        drive_folder_id: true,
        is_active: true,
        created_at: true,
      },
    });

    res.json({ user });
  } catch (err) {
    if (err.code === 'P2025') {
      return res.status(404).json({ error: 'Utilisateur non trouvé' });
    }
    console.error('Update user error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/admin/users/:id/reset-password
router.put('/users/:id/reset-password', async (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);
    if (isNaN(userId)) return res.status(400).json({ error: 'ID invalide' });
    const { newPassword } = req.body;

    if (!newPassword || newPassword.length < 8 || newPassword.length > 128) {
      return res.status(400).json({ error: 'Mot de passe entre 8 et 128 caractères requis' });
    }

    const password_hash = await bcrypt.hash(newPassword, 12);

    await req.prisma.user.update({
      where: { id: userId },
      data: { password_hash },
    });

    res.json({ message: 'Mot de passe réinitialisé' });
  } catch (err) {
    if (err.code === 'P2025') {
      return res.status(404).json({ error: 'Utilisateur non trouvé' });
    }
    console.error('Reset password error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/admin/stats — Global stats for admin dashboard
router.get('/stats', async (req, res) => {
  try {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);

    const monthWhere = {
      date_ticket: { gte: startOfMonth, lte: endOfMonth },
    };

    const [monthTotal, monthByType, monthByUser, totalUsers, totalExpenses] = await Promise.all([
      req.prisma.expense.aggregate({
        where: monthWhere,
        _sum: { amount: true },
        _count: true,
      }),
      req.prisma.expense.groupBy({
        by: ['type'],
        where: monthWhere,
        _sum: { amount: true },
        _count: true,
      }),
      req.prisma.expense.groupBy({
        by: ['user_id'],
        where: monthWhere,
        _sum: { amount: true },
        _count: true,
      }),
      req.prisma.user.count({ where: { is_active: true } }),
      req.prisma.expense.count(),
    ]);

    // Enrich user stats with names
    const userIds = monthByUser.map(u => u.user_id);
    const users = await req.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true, card_id: true },
    });
    const userMap = Object.fromEntries(users.map(u => [u.id, u]));

    const userStats = monthByUser.map(u => ({
      userId: u.user_id,
      name: userMap[u.user_id]?.name || 'Inconnu',
      card_id: userMap[u.user_id]?.card_id || null,
      total: u._sum.amount || 0,
      count: u._count,
    }));

    res.json({
      month: {
        total: monthTotal._sum.amount || 0,
        count: monthTotal._count,
      },
      byType: monthByType.map(t => ({
        type: t.type,
        total: t._sum.amount || 0,
        count: t._count,
      })),
      byUser: userStats,
      totals: {
        users: totalUsers,
        expenses: totalExpenses,
      },
    });
  } catch (err) {
    console.error('Admin stats error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/admin/expenses — all expenses with user filter
router.get('/expenses', async (req, res) => {
  try {
    const { user_id, type, month, year } = req.query;
    const rawPage = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const rawLimit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100);
    const skip = (rawPage - 1) * rawLimit;
    const where = {};

    if (user_id) {
      const uid = parseInt(user_id, 10);
      if (!isNaN(uid)) where.user_id = uid;
    }
    if (type) where.type = type;
    if (month && year) {
      where.date_ticket = {
        gte: new Date(parseInt(year), parseInt(month) - 1, 1),
        lte: new Date(parseInt(year), parseInt(month), 0),
      };
    }

    const [expenses, total] = await Promise.all([
      req.prisma.expense.findMany({
        where,
        include: {
          user: { select: { id: true, name: true, card_id: true } },
        },
        orderBy: { date_ticket: 'desc' },
        skip,
        take: rawLimit,
      }),
      req.prisma.expense.count({ where }),
    ]);

    res.json({
      expenses,
      pagination: {
        total,
        page: rawPage,
        limit: rawLimit,
        totalPages: Math.ceil(total / rawLimit),
      },
    });
  } catch (err) {
    console.error('Admin expenses error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/admin/drive-config
router.get('/drive-config', async (req, res) => {
  try {
    const config = await req.prisma.driveConfig.findFirst();
    res.json({ config: config || null });
  } catch (err) {
    console.error('Drive config error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/admin/drive-config
router.put('/drive-config', async (req, res) => {
  try {
    const { root_folder_id, service_account_email } = req.body;

    const existing = await req.prisma.driveConfig.findFirst();

    let config;
    if (existing) {
      config = await req.prisma.driveConfig.update({
        where: { id: existing.id },
        data: { root_folder_id, service_account_email },
      });
    } else {
      config = await req.prisma.driveConfig.create({
        data: { root_folder_id, service_account_email },
      });
    }

    res.json({ config });
  } catch (err) {
    console.error('Update drive config error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/admin/export-failed — Download all failed receipts as ZIP
router.get('/export-failed', async (req, res) => {
  try {
    const archiver = require('archiver');
    const { generatePDF } = require('../services/pdf');

    const failedExpenses = await req.prisma.expense.findMany({
      where: {
        upload_status: 'error',
        has_receipt: true,
      },
      include: {
        user: { select: { name: true, card_id: true } },
      },
      orderBy: { date_ticket: 'desc' },
    });

    if (failedExpenses.length === 0) {
      return res.status(404).json({ error: 'Aucune dépense en erreur avec justificatif' });
    }

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename=justificatifs-echec-drive-${new Date().toISOString().slice(0, 10)}.zip`);

    const archive = archiver('zip', { zlib: { level: 5 } });
    archive.pipe(res);

    for (const expense of failedExpenses) {
      const dateStr = new Date(expense.date_ticket).toISOString().slice(0, 10);
      const userName = expense.user.name.split(' ')[0];
      const imgBuffer = expense.receipt_image ? Buffer.from(expense.receipt_image) : null;

      // Add the raw image
      if (imgBuffer && imgBuffer.length > 0) {
        archive.append(imgBuffer, {
          name: `${dateStr}_${expense.type}_${Number(expense.amount).toFixed(2)}EUR_${userName}_photo.jpg`,
        });
      }

      // Also generate and add the PDF
      try {
        const pdfBuffer = await generatePDF({
          imageBuffer: imgBuffer,
          imageMime: imgBuffer ? 'image/jpeg' : null,
          date: expense.date_ticket,
          amount: Number(expense.amount),
          type: expense.type,
          merchant: expense.merchant || '',
          description: expense.description || '',
          userName: expense.user.name,
          cardId: expense.user.card_id,
        });
        archive.append(pdfBuffer, {
          name: expense.file_name || `${dateStr}_${expense.type}_${Number(expense.amount).toFixed(2)}EUR_${userName}.pdf`,
        });
      } catch (pdfErr) {
        console.error(`[export-failed] PDF generation error for expense ${expense.id}:`, pdfErr.message);
      }
    }

    await archive.finalize();
  } catch (err) {
    console.error('Export failed receipts error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }
});

// POST /api/admin/acknowledge-zip — Mark all failed receipts as exported (ZIP downloaded)
router.post('/acknowledge-zip', async (req, res) => {
  try {
    const result = await req.prisma.expense.updateMany({
      where: {
        upload_status: 'error',
        has_receipt: true,
      },
      data: {
        upload_status: 'exported',
      },
    });

    res.json({
      success: true,
      count: result.count,
      message: `${result.count} justificatif(s) marqué(s) comme exporté(s)`,
    });
  } catch (err) {
    console.error('Acknowledge ZIP error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
