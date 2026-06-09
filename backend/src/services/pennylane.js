/**
 * Client API Pennylane (v2 - Company API), lecture seule.
 * Sert au rapprochement : récupère les transactions du compte Pro (cartes)
 * pour les comparer aux justificatifs scannés dans scan-docu.
 *
 * Variables d'environnement :
 *   PENNYLANE_TOKEN              (requis)  token API Pennylane — un scope `transactions:readonly` suffit
 *   PENNYLANE_API_URL            (option)  défaut https://app.pennylane.com/api/external/v2
 *   PENNYLANE_PRO_BANK_ACCOUNT_ID (option) id du compte bancaire Pro portant les cartes (défaut 949694)
 */

const API_URL = (process.env.PENNYLANE_API_URL || 'https://app.pennylane.com/api/external/v2').replace(/\/$/, '');
const TOKEN = process.env.PENNYLANE_TOKEN || '';
const PRO_BANK_ACCOUNT_ID = parseInt(process.env.PENNYLANE_PRO_BANK_ACCOUNT_ID || '949694', 10);

const RATE_SLEEP_MS = 280; // 25 req / 5s -> ~1 req / 200ms, marge de sécurité
const MAX_RETRIES = 5;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function isConfigured() {
  return Boolean(TOKEN);
}

/**
 * Appel GET bas niveau avec retry sur 429 (rate limit) et 500 (erreurs transitoires).
 */
async function apiGet(path, { searchParams } = {}) {
  if (!TOKEN) {
    const err = new Error('PENNYLANE_TOKEN non configuré');
    err.code = 'NO_TOKEN';
    throw err;
  }

  const url = new URL(`${API_URL}${path}`);
  if (searchParams) {
    for (const [k, v] of Object.entries(searchParams)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, v);
    }
  }

  let lastErr;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    let res;
    try {
      res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          Accept: 'application/json',
        },
      });
    } catch (e) {
      lastErr = e;
      await sleep(500 * (attempt + 1));
      continue;
    }

    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get('retry-after') || '2', 10);
      await sleep((retryAfter || 2) * 1000);
      continue;
    }
    if (res.status >= 500) {
      lastErr = new Error(`Pennylane ${res.status}`);
      await sleep(1000 * (attempt + 1));
      continue;
    }

    const text = await res.text();
    let body;
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      lastErr = new Error('Réponse Pennylane non-JSON');
      await sleep(500);
      continue;
    }

    if (res.status === 401 || res.status === 403 || body?.status === 401) {
      const err = new Error('Authentification Pennylane refusée (token ou scope invalide)');
      err.code = 'AUTH';
      throw err;
    }
    if (!res.ok) {
      const err = new Error(body?.message || `Erreur Pennylane ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return body;
  }
  throw lastErr || new Error('Échec appel Pennylane après retries');
}

/**
 * Vérifie l'auth et renvoie les infos de l'entreprise.
 */
async function checkConnection() {
  if (!isConfigured()) {
    return { ok: false, configured: false, error: 'PENNYLANE_TOKEN non configuré' };
  }
  try {
    const me = await apiGet('/me');
    return {
      ok: true,
      configured: true,
      company: me?.company?.name || null,
      email: me?.user?.email || null,
      scopes: me?.scopes || [],
    };
  } catch (e) {
    return { ok: false, configured: true, error: e.message, code: e.code };
  }
}

function buildFilter(from, to) {
  const filter = [
    { field: 'bank_account_id', operator: 'eq', value: PRO_BANK_ACCOUNT_ID },
  ];
  if (from) filter.push({ field: 'date', operator: 'gteq', value: from });
  if (to) filter.push({ field: 'date', operator: 'lteq', value: to });
  return JSON.stringify(filter);
}

function normalizeTransaction(t) {
  const pae = t.pro_account_expense || null;
  const masked = pae?.card_masked_number || null;
  const employee = pae?.employee
    ? [pae.employee.first_name, pae.employee.last_name].filter(Boolean).join(' ')
    : null;
  const amount = parseFloat(t.amount); // négatif = dépense (sortie)
  return {
    id: t.id,
    date: t.date,
    label: t.label || '',
    amount, // signé
    absAmount: Math.abs(amount),
    isExpense: amount < 0,
    currency: t.currency || 'EUR',
    cardMasked: masked,
    cardLast4: masked ? masked.slice(-4) : null,
    employee,
    attachmentRequired: Boolean(t.attachment_required),
    matchedInvoicesUrl: t.matched_invoices?.url || null,
  };
}

/**
 * Récupère toutes les transactions du compte Pro entre deux dates (incluses).
 * @param {{from?: string, to?: string}} range dates YYYY-MM-DD
 * @returns {Promise<Array>} transactions normalisées
 */
async function fetchProTransactions({ from, to } = {}) {
  const all = [];
  let cursor = null;
  let guard = 0;
  do {
    const body = await apiGet('/transactions', {
      searchParams: {
        limit: 100,
        filter: buildFilter(from, to),
        ...(cursor ? { cursor } : {}),
      },
    });
    const items = body.items || [];
    for (const t of items) all.push(normalizeTransaction(t));
    cursor = body.has_more ? body.next_cursor : null;
    if (cursor) await sleep(RATE_SLEEP_MS);
  } while (cursor && ++guard < 200);

  return all;
}

async function listBankAccounts() {
  const body = await apiGet('/bank_accounts', { searchParams: { limit: 100 } });
  return (body.items || []).map((a) => ({ id: a.id, name: a.name || a.label || null }));
}

module.exports = {
  isConfigured,
  checkConnection,
  fetchProTransactions,
  listBankAccounts,
  PRO_BANK_ACCOUNT_ID,
  API_URL,
};
