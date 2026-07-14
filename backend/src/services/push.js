/**
 * Notifications push (Web Push / VAPID).
 * Abonnements stockés dans la table Setting (clé "push_sub:<userId>" -> JSON array
 * de subscriptions, pour gérer plusieurs appareils par collaborateur).
 *
 * Env requises : VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:...).
 */
const webpush = require('web-push');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '';
const PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
const SUBJECT = process.env.VAPID_SUBJECT || 'mailto:labrasseriedesplantes@gmail.com';

let configured = false;
if (PUBLIC_KEY && PRIVATE_KEY) {
  try {
    webpush.setVapidDetails(SUBJECT, PUBLIC_KEY, PRIVATE_KEY);
    configured = true;
  } catch (e) {
    console.error('[push] VAPID config error:', e.message);
  }
}

const keyFor = (userId) => `push_sub:${userId}`;

function isConfigured() {
  return configured;
}

function publicKey() {
  return PUBLIC_KEY || null;
}

async function getSubscriptions(userId) {
  try {
    const row = await prisma.setting.findUnique({ where: { key: keyFor(userId) } });
    if (!row?.value) return [];
    const arr = JSON.parse(row.value);
    return Array.isArray(arr) ? arr : [arr];
  } catch {
    return [];
  }
}

async function setSubscriptions(userId, subs) {
  await prisma.setting.upsert({
    where: { key: keyFor(userId) },
    update: { value: JSON.stringify(subs) },
    create: { key: keyFor(userId), value: JSON.stringify(subs) },
  });
}

async function saveSubscription(userId, sub) {
  if (!sub?.endpoint) throw new Error('subscription invalide');
  const subs = await getSubscriptions(userId);
  const next = subs.filter((s) => s.endpoint !== sub.endpoint);
  next.push(sub);
  await setSubscriptions(userId, next);
}

async function removeSubscription(userId, endpoint) {
  const subs = await getSubscriptions(userId);
  const next = endpoint ? subs.filter((s) => s.endpoint !== endpoint) : [];
  await setSubscriptions(userId, next);
}

// Envoie une notif à tous les appareils d'un utilisateur ; purge les abonnements expirés.
async function sendToUser(userId, payload) {
  if (!configured) return { sent: 0, failed: 0 };
  const subs = await getSubscriptions(userId);
  if (subs.length === 0) return { sent: 0, failed: 0 };

  let sent = 0;
  let failed = 0;
  const alive = [];
  for (const sub of subs) {
    try {
      await webpush.sendNotification(sub, JSON.stringify(payload));
      sent++;
      alive.push(sub);
    } catch (e) {
      failed++;
      // 404/410 = abonnement expiré -> on le retire ; sinon on le garde
      if (e.statusCode !== 404 && e.statusCode !== 410) alive.push(sub);
    }
  }
  if (alive.length !== subs.length) await setSubscriptions(userId, alive);
  return { sent, failed };
}

// Envoie une notif à tous les administrateurs actifs (ex. nouvelle demande de remboursement).
async function sendToAdmins(payload) {
  if (!configured) return { sent: 0, failed: 0 };
  const admins = await prisma.user.findMany({
    where: { role: 'admin', is_active: true },
    select: { id: true },
  });
  let sent = 0;
  let failed = 0;
  for (const a of admins) {
    const r = await sendToUser(a.id, payload);
    sent += r.sent;
    failed += r.failed;
  }
  return { sent, failed };
}

module.exports = {
  isConfigured,
  publicKey,
  getSubscriptions,
  saveSubscription,
  removeSubscription,
  sendToUser,
  sendToAdmins,
};
