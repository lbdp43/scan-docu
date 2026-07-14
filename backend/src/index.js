const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const hpp = require('hpp');
const rateLimit = require('express-rate-limit');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const { PrismaClient } = require('@prisma/client');

const authRoutes = require('./routes/auth');
const expensesRoutes = require('./routes/expenses');
const adminRoutes = require('./routes/admin');
const scanRoutes = require('./routes/scan');
const driveSetupRoutes = require('./routes/driveSetup');
const expenseTypesRoutes = require('./routes/expenseTypes');
const pennylaneRoutes = require('./routes/pennylane');
const myPaymentsRoutes = require('./routes/myPayments');
const reimbursementRoutes = require('./routes/reimbursements');
const pushRoutes = require('./routes/push');
const cronRoutes = require('./routes/cron');
const { warmupWorker } = require('./services/ocr');

const prisma = new PrismaClient();
const app = express();
const PORT = process.env.PORT || 3000;

// Trust proxy (Railway, Heroku, etc.)
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      connectSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

app.use(hpp());

// CORS
const allowedOrigins = process.env.FRONTEND_URL
  ? [process.env.FRONTEND_URL]
  : ['http://localhost:5173'];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  maxAge: 86400,
}));

// Global rate limiting
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de requêtes. Réessayez plus tard.' },
});
app.use('/api', globalLimiter);

// Body parsing
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Make prisma available to routes
app.use((req, res, next) => {
  req.prisma = prisma;
  next();
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/expenses', expensesRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/scan', scanRoutes);
app.use('/api/drive', driveSetupRoutes);
app.use('/api/expense-types', expenseTypesRoutes);
app.use('/api/pennylane', pennylaneRoutes);
app.use('/api/my-payments', myPaymentsRoutes);
app.use('/api/reimbursements', reimbursementRoutes);
app.use('/api/push', pushRoutes);
app.use('/api/cron', cronRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve frontend static files in production
if (process.env.NODE_ENV === 'production') {
  const frontendPath = path.join(__dirname, '../../frontend/dist');
  app.use(express.static(frontendPath));
  app.get('*', (req, res) => {
    res.sendFile(path.join(frontendPath, 'index.html'));
  });
}

// Error handling
app.use((err, req, res, next) => {
  console.error('Error:', err.message);
  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({ error: 'CORS non autorisé' });
  }
  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production'
      ? 'Erreur serveur'
      : err.message,
  });
});

// Prevent unhandled errors from crashing the server (e.g. Tesseract worker errors)
process.on('unhandledRejection', (reason, promise) => {
  console.error('[process] Unhandled rejection:', reason);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  await prisma.$disconnect();
  process.exit(0);
});

async function ensureAdminExists() {
  try {
    const count = await prisma.user.count();
    console.log(`[startup] Users in DB: ${count}`);
    if (count === 0) {
      console.log('[startup] No users found, creating default admin...');
      const defaultPassword = process.env.DEFAULT_ADMIN_PASSWORD || crypto.randomBytes(16).toString('hex');
      const hash = await bcrypt.hash(defaultPassword, 12);
      await prisma.user.create({
        data: {
          email: 'guillaume@lbdp.fr',
          password_hash: hash,
          name: 'Guillaume Darinot',
          role: 'admin',
          card_id: 'CARTE-001',
        },
      });
      if (process.env.DEFAULT_ADMIN_PASSWORD) {
        console.log('[startup] Admin user created: guillaume@lbdp.fr — change password after first login');
      } else {
        console.log(`[startup] Admin user created: guillaume@lbdp.fr — generated password: ${defaultPassword}`);
        console.log('[startup] Set DEFAULT_ADMIN_PASSWORD env var to control this');
      }
    } else {
      console.log('[startup] Users already exist, skipping admin creation');
    }
  } catch (err) {
    console.error('[startup] Error checking/creating admin:', err.message);
  }
}

// Cleanup expired blacklisted tokens periodically
async function cleanupExpiredTokens() {
  try {
    const result = await prisma.tokenBlacklist.deleteMany({
      where: { expires_at: { lt: new Date() } },
    });
    if (result.count > 0) {
      console.log(`[cleanup] Removed ${result.count} expired blacklisted tokens`);
    }
  } catch (err) {
    console.error('[cleanup] Token cleanup error:', err.message);
  }
}

async function ensureDefaultExpenseTypes() {
  try {
    const count = await prisma.expenseType.count();
    if (count === 0) {
      console.log('[startup] No expense types found, seeding defaults...');
      await prisma.expenseType.createMany({
        data: [
          { value: 'carburant', label: 'Carburant', icon: '⛽', color: '#4A9E40', position: 0 },
          { value: 'repas', label: 'Repas', icon: '🍽️', color: '#F97316', position: 1 },
          { value: 'peage', label: 'Péage', icon: '🛣️', color: '#3B82F6', position: 2 },
          { value: 'autre', label: 'Autre', icon: '📄', color: '#6B7280', position: 3 },
        ],
        skipDuplicates: true,
      });
      console.log('[startup] Default expense types seeded');
    }
  } catch (err) {
    console.error('[startup] Error seeding expense types:', err.message);
  }
}

app.listen(PORT, async () => {
  console.log(`LBDP API running on port ${PORT}`);
  await ensureAdminExists();
  await ensureDefaultExpenseTypes();
  await cleanupExpiredTokens();
  setInterval(cleanupExpiredTokens, 60 * 60 * 1000); // Cleanup every hour
  // Pre-warm Tesseract so the first scan request is instant
  warmupWorker().catch(() => {});
});

module.exports = app;
