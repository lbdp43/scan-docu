const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const slowDown = require('express-slow-down');
const { z } = require('zod');
const { authenticateToken, JWT_SECRET } = require('../middleware/auth');
const { validate } = require('../middleware/validate');

const router = express.Router();

const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret';

// Rate limiting for login
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Trop de tentatives. Réessayez dans 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const loginSlowDown = slowDown({
  windowMs: 15 * 60 * 1000,
  delayAfter: 3,
  delayMs: (hits) => hits * 1000,
});

// Validation schemas
const loginSchema = z.object({
  email: z.string().email('Email invalide').toLowerCase().trim(),
  password: z.string().min(1, 'Mot de passe requis').max(128),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, 'Le mot de passe doit contenir au moins 8 caractères').max(128),
});

// POST /api/auth/login
router.post('/login', loginLimiter, loginSlowDown, validate(loginSchema), async (req, res) => {
  try {
    const { email, password } = req.validatedBody;

    const user = await req.prisma.user.findUnique({
      where: { email },
    });

    if (!user || !user.is_active) {
      return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
    }

    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
    }

    // Access token (8h)
    const accessToken = jwt.sign(
      { userId: user.id, role: user.role },
      JWT_SECRET,
      { expiresIn: '8h' }
    );

    // Refresh token (30 days)
    const refreshToken = jwt.sign(
      { userId: user.id, type: 'refresh' },
      REFRESH_SECRET,
      { expiresIn: '30d' }
    );

    res.json({
      token: accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        card_id: user.card_id,
      },
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/auth/refresh
router.post('/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      return res.status(401).json({ error: 'Refresh token requis' });
    }

    const decoded = jwt.verify(refreshToken, REFRESH_SECRET);

    // Check if token is blacklisted
    const blacklisted = await req.prisma.tokenBlacklist.findUnique({
      where: { token: refreshToken },
    });
    if (blacklisted) {
      return res.status(401).json({ error: 'Token révoqué' });
    }

    const user = await req.prisma.user.findUnique({
      where: { id: decoded.userId },
    });

    if (!user || !user.is_active) {
      return res.status(401).json({ error: 'Utilisateur non trouvé ou désactivé' });
    }

    const accessToken = jwt.sign(
      { userId: user.id, role: user.role },
      JWT_SECRET,
      { expiresIn: '8h' }
    );

    res.json({ token: accessToken });
  } catch (err) {
    return res.status(401).json({ error: 'Refresh token invalide' });
  }
});

// POST /api/auth/logout
router.post('/logout', authenticateToken, async (req, res) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (token) {
      await req.prisma.tokenBlacklist.create({
        data: {
          token,
          expires_at: new Date(Date.now() + 8 * 60 * 60 * 1000),
        },
      });
    }

    res.json({ message: 'Déconnecté' });
  } catch (err) {
    console.error('Logout error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/auth/me
router.get('/me', authenticateToken, async (req, res) => {
  try {
    const user = await req.prisma.user.findUnique({
      where: { id: req.user.userId },
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

    if (!user) {
      return res.status(404).json({ error: 'Utilisateur non trouvé' });
    }

    res.json({ user });
  } catch (err) {
    console.error('Me error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/auth/password
router.put('/password', authenticateToken, validate(changePasswordSchema), async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.validatedBody;

    const user = await req.prisma.user.findUnique({
      where: { id: req.user.userId },
    });

    const validPassword = await bcrypt.compare(currentPassword, user.password_hash);
    if (!validPassword) {
      return res.status(400).json({ error: 'Mot de passe actuel incorrect' });
    }

    const password_hash = await bcrypt.hash(newPassword, 12);
    await req.prisma.user.update({
      where: { id: req.user.userId },
      data: { password_hash },
    });

    res.json({ message: 'Mot de passe modifié' });
  } catch (err) {
    console.error('Password change error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
