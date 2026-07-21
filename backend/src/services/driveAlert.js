/**
 * Alerte admin quand la connexion Google Drive tombe (auth expirée).
 * Push aux admins, throttlé à 1 par heure pour ne pas spammer pendant une
 * panne. L'alerte est réarmée dès qu'un upload réussit à nouveau.
 */
const push = require('./push');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const KEY = 'drive_down_alert_at';
const COOLDOWN_MS = 60 * 60 * 1000; // 1h

async function notifyDriveDown() {
  try {
    const row = await prisma.setting.findUnique({ where: { key: KEY } });
    const last = row?.value ? Date.parse(row.value) : 0;
    if (Number.isFinite(last) && Date.now() - last < COOLDOWN_MS) return; // throttle

    const now = new Date().toISOString();
    await prisma.setting.upsert({
      where: { key: KEY },
      update: { value: now },
      create: { key: KEY, value: now },
    });

    await push.sendToAdmins({
      title: '⚠️ Connexion Google Drive interrompue',
      body: 'Les justificatifs ne sont plus envoyés sur Drive. Reconnecte le Drive dans Admin.',
      url: '/admin',
      tag: 'drive-down',
    });
    console.warn('[driveAlert] Admins notified: Drive auth down');
  } catch (e) {
    console.error('[driveAlert] notify error:', e.message);
  }
}

// Réarme l'alerte après un succès : la prochaine panne notifiera immédiatement.
async function clearDriveDown() {
  try {
    await prisma.setting.deleteMany({ where: { key: KEY } });
  } catch {
    // ignore
  }
}

module.exports = { notifyDriveDown, clearDriveDown };
