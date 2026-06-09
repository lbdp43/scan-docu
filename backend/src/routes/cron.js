/**
 * Endpoints déclenchés par un cron externe (GitHub Actions), authentifiés par
 * un secret partagé (header x-cron-secret), PAS par JWT.
 *
 * - POST /api/cron/reconcile (horaire) : rapprochement + recalcul du snapshot des manquants.
 * - POST /api/cron/daily (quotidien)   : idem + push à chaque collaborateur de SES manquants.
 */
const express = require('express');
const { PrismaClient } = require('@prisma/client');
const pennylane = require('../services/pennylane');
const push = require('../services/push');
const missing = require('../services/missing');
const { runCardDirectReconcile } = require('../services/cardReconcile');
const { categorizeByType } = require('../services/categorize');

const router = express.Router();
const prisma = new PrismaClient();

// Auth par secret partagé
router.use((req, res, next) => {
  const secret = process.env.CRON_SECRET;
  if (!secret) return res.status(503).json({ error: 'CRON_SECRET non configuré' });
  const given = req.headers['x-cron-secret'] || req.query.secret;
  if (given !== secret) return res.status(401).json({ error: 'Non autorisé' });
  next();
});

// Recalcule le snapshot des manquants (et notifie chaque collaborateur si demandé).
async function refreshSnapshot({ notify }) {
  const snap = await missing.buildAndStore(prisma);
  const out = {
    computedAt: snap.computedAt,
    fiscalYear: snap.fiscalYear,
    totalMissing: snap.summary?.unmatched ?? null,
  };
  if (notify && push.isConfigured() && snap.connection?.ok) {
    const byUser = {};
    for (const c of snap.cards || []) {
      if (c.userId && c.missing > 0) {
        const u = (byUser[c.userId] = byUser[c.userId] || { missing: 0, amount: 0 });
        u.missing += c.missing;
        u.amount += c.amountMissing;
      }
    }
    const notes = [];
    for (const [uid, v] of Object.entries(byUser)) {
      const r = await push.sendToUser(parseInt(uid, 10), {
        title: 'Paiements à justifier',
        body: `${v.missing} paiement${v.missing > 1 ? 's' : ''} (${v.amount.toFixed(2)} €) sans justificatif. Scanne tes tickets 📷`,
        url: '/dashboard',
        tag: 'lbdp-missing',
      });
      notes.push({ userId: uid, missing: v.missing, sent: r.sent });
    }
    out.push = { notified: notes.length, results: notes };
  }
  return out;
}

router.post('/daily', async (req, res) => {
  const out = {};
  try { out.reconcile = await runCardDirectReconcile(); } catch (e) { out.reconcile = { error: e.message }; }
  try { out.categorize = await categorizeByType(prisma); } catch (e) { out.categorize = { error: e.message }; }
  try { out.missing = await refreshSnapshot({ notify: true }); } catch (e) { out.missing = { error: e.message }; }
  res.json({ ok: true, ...out });
});

router.post('/reconcile', async (req, res) => {
  const out = {};
  try { out.reconcile = await runCardDirectReconcile(); } catch (e) { out.reconcile = { error: e.message }; }
  try { out.categorize = await categorizeByType(prisma); } catch (e) { out.categorize = { error: e.message }; }
  try { out.missing = await refreshSnapshot({ notify: false }); } catch (e) { out.missing = { error: e.message }; }
  res.json({ ok: true, ...out });
});

module.exports = router;
