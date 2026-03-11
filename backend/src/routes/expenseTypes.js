const express = require('express');
const { z } = require('zod');
const { authenticateToken, checkAdmin } = require('../middleware/auth');
const { validate } = require('../middleware/validate');

const router = express.Router();

// GET /api/expense-types — List all active types (any authenticated user)
router.get('/', authenticateToken, async (req, res) => {
  try {
    const types = await req.prisma.expenseType.findMany({
      where: { is_active: true },
      orderBy: { position: 'asc' },
    });
    res.json({ types });
  } catch (err) {
    console.error('List expense types error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/expense-types/all — List ALL types including inactive (admin only)
router.get('/all', authenticateToken, checkAdmin, async (req, res) => {
  try {
    const types = await req.prisma.expenseType.findMany({
      orderBy: { position: 'asc' },
    });
    res.json({ types });
  } catch (err) {
    console.error('List all expense types error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Validation schemas
const createTypeSchema = z.object({
  value: z.string().min(2).max(30).trim().toLowerCase()
    .regex(/^[a-z0-9_-]+$/, 'Uniquement lettres minuscules, chiffres, tirets et underscores'),
  label: z.string().min(1).max(50).trim(),
  icon: z.string().min(1).max(10),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Format couleur hex invalide (#RRGGBB)').optional().default('#6B7280'),
  position: z.number().int().min(0).optional(),
});

const updateTypeSchema = z.object({
  label: z.string().min(1).max(50).trim().optional(),
  icon: z.string().min(1).max(10).optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  position: z.number().int().min(0).optional(),
  is_active: z.boolean().optional(),
});

// POST /api/expense-types — Create type (admin only)
router.post('/', authenticateToken, checkAdmin, validate(createTypeSchema), async (req, res) => {
  try {
    const data = req.validatedBody;

    const existing = await req.prisma.expenseType.findUnique({
      where: { value: data.value },
    });
    if (existing) {
      return res.status(409).json({ error: 'Un type avec cette valeur existe déjà' });
    }

    // Auto-set position if not provided
    if (data.position === undefined) {
      const maxPos = await req.prisma.expenseType.aggregate({ _max: { position: true } });
      data.position = (maxPos._max.position ?? -1) + 1;
    }

    const type = await req.prisma.expenseType.create({ data });
    res.status(201).json({ type });
  } catch (err) {
    console.error('Create expense type error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/expense-types/:id — Update type (admin only)
router.put('/:id', authenticateToken, checkAdmin, validate(updateTypeSchema), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'ID invalide' });

    const type = await req.prisma.expenseType.update({
      where: { id },
      data: req.validatedBody,
    });
    res.json({ type });
  } catch (err) {
    if (err.code === 'P2025') {
      return res.status(404).json({ error: 'Type non trouvé' });
    }
    console.error('Update expense type error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /api/expense-types/:id — Delete type (admin only)
// Only allowed if no expenses use this type. Otherwise, deactivate instead.
router.delete('/:id', authenticateToken, checkAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'ID invalide' });

    const typeRecord = await req.prisma.expenseType.findUnique({ where: { id } });
    if (!typeRecord) return res.status(404).json({ error: 'Type non trouvé' });

    // Check if any expenses use this type
    const usageCount = await req.prisma.expense.count({ where: { type: typeRecord.value } });
    if (usageCount > 0) {
      // Deactivate instead of delete
      await req.prisma.expenseType.update({
        where: { id },
        data: { is_active: false },
      });
      return res.json({
        success: true,
        deactivated: true,
        message: `Type désactivé (utilisé par ${usageCount} dépense${usageCount > 1 ? 's' : ''})`,
      });
    }

    await req.prisma.expenseType.delete({ where: { id } });
    res.json({ success: true, deleted: true });
  } catch (err) {
    console.error('Delete expense type error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
