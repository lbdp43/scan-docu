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

// Bilan mensuel pour les ADMINS : paiements du mois écoulé restés sans
// justificatif, agrégés par collaborateur. Déclenché le 1er du mois.
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

router.post('/monthly', async (req, res) => {
  try {
    // Snapshot frais (inclut la vérification "Pennylane fait foi")
    const snap = await missing.buildAndStore(prisma);
    if (!snap.connection?.ok) {
      return res.json({ ok: false, error: 'Pennylane non connecté' });
    }

    // Mois écoulé (le cron tourne le 1er au matin)
    const now = new Date();
    const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const prevKey = `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, '0')}`;
    const prevLabel = MOIS[prev.getUTCMonth()];

    // Manquants datés du mois écoulé, agrégés par collaborateur (via la carte)
    const cardUser = {};
    for (const c of snap.cards || []) {
      if (c.masked && c.userId != null) cardUser[c.masked] = c.userId;
    }
    const byUser = {}; // userId|0 -> { count, amount }
    let count = 0;
    let amount = 0;
    for (const t of snap.transactions || []) {
      if (!String(t.date || '').startsWith(prevKey)) continue;
      const uid = (t.card?.masked && cardUser[t.card.masked]) || 0; // 0 = carte non attribuée
      const b = (byUser[uid] = byUser[uid] || { count: 0, amount: 0 });
      b.count += 1;
      b.amount += Number(t.amount || 0);
      count += 1;
      amount += Number(t.amount || 0);
    }

    const fr = (n) => n.toFixed(2).replace('.', ',') + ' €';
    let payload;
    if (count === 0) {
      payload = {
        title: `Bilan ${prevLabel} ✓`,
        body: `Tous les paiements carte de ${prevLabel} ont été justifiés 👏`,
        url: '/admin/pennylane',
        tag: 'lbdp-monthly',
      };
    } else {
      // Noms des collaborateurs concernés
      const ids = Object.keys(byUser).map(Number).filter(Boolean);
      const users = ids.length
        ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
        : [];
      const nameOf = Object.fromEntries(users.map((u) => [u.id, u.name.split(' ')[0]]));
      const parts = Object.entries(byUser)
        .sort((a, b) => b[1].amount - a[1].amount)
        .map(([uid, v]) => `${uid === '0' ? 'Carte non attribuée' : (nameOf[uid] || `#${uid}`)} ${v.count} (${fr(v.amount)})`);
      const shown = parts.slice(0, 4).join(' · ') + (parts.length > 4 ? ` · +${parts.length - 4}` : '');
      payload = {
        title: `Bilan ${prevLabel} : ${count} paiement${count > 1 ? 's' : ''} non justifié${count > 1 ? 's' : ''} (${fr(amount)})`,
        body: shown,
        url: '/admin/pennylane',
        tag: 'lbdp-monthly',
      };
    }

    const sent = push.isConfigured() ? await push.sendToAdmins(payload) : { sent: 0, failed: 0 };
    res.json({ ok: true, month: prevKey, count, amount: +amount.toFixed(2), byUser, push: sent });
  } catch (e) {
    console.error('[cron] monthly error:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post('/reconcile', async (req, res) => {
  const out = {};
  try { out.reconcile = await runCardDirectReconcile(); } catch (e) { out.reconcile = { error: e.message }; }
  try { out.categorize = await categorizeByType(prisma); } catch (e) { out.categorize = { error: e.message }; }
  try { out.missing = await refreshSnapshot({ notify: false }); } catch (e) { out.missing = { error: e.message }; }
  res.json({ ok: true, ...out });
});

module.exports = router;
