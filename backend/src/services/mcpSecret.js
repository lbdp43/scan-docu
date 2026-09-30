/**
 * Clé secrète du connecteur MCP (Claude / ChatGPT).
 * L'URL du connecteur est /mcp/<clé> : les clients IA ne gèrent pas tous un
 * en-tête d'authentification fixe, la clé dans l'URL fonctionne partout.
 * Stockée dans Setting "mcp_secret" (générée au premier affichage admin,
 * régénérable). La variable d'env MCP_SECRET, si définie, a priorité.
 */
const crypto = require('crypto');

const KEY = 'mcp_secret';

async function getSecret(prisma, { create = false } = {}) {
  const fromEnv = (process.env.MCP_SECRET || '').trim();
  if (fromEnv) return fromEnv;
  const row = await prisma.setting.findUnique({ where: { key: KEY } });
  if (row?.value) return row.value;
  if (!create) return null;
  return regenerate(prisma);
}

async function regenerate(prisma) {
  const value = crypto.randomBytes(24).toString('hex');
  await prisma.setting.upsert({
    where: { key: KEY },
    update: { value },
    create: { key: KEY, value },
  });
  return value;
}

function sameSecret(given, expected) {
  if (!given || !expected) return false;
  const a = Buffer.from(String(given));
  const b = Buffer.from(String(expected));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = { getSecret, regenerate, sameSecret, fromEnv: () => !!(process.env.MCP_SECRET || '').trim() };
