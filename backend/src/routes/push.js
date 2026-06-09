const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const push = require('../services/push');

const router = express.Router();
router.use(authenticateToken);

// GET /api/push/public-key — clé publique VAPID (pour s'abonner côté navigateur)
router.get('/public-key', (req, res) => {
  if (!push.isConfigured()) return res.json({ configured: false, key: null });
  res.json({ configured: true, key: push.publicKey() });
});

// GET /api/push/status — l'utilisateur est-il abonné ?
router.get('/status', async (req, res) => {
  try {
    const subs = await push.getSubscriptions(req.user.userId);
    res.json({ configured: push.isConfigured(), subscribed: subs.length > 0, devices: subs.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/push/subscribe — enregistre l'abonnement du navigateur
router.post('/subscribe', async (req, res) => {
  try {
    const { subscription } = req.body;
    if (!subscription?.endpoint) return res.status(400).json({ error: 'subscription requise' });
    await push.saveSubscription(req.user.userId, subscription);
    res.json({ success: true });
  } catch (err) {
    console.error('[push] subscribe error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/push/unsubscribe — retire l'abonnement
router.post('/unsubscribe', async (req, res) => {
  try {
    await push.removeSubscription(req.user.userId, req.body?.endpoint);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
