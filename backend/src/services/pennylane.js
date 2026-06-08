const { PrismaClient } = require('@prisma/client');

const BASE_URL = 'https://app.pennylane.com/api/external/v2';
const HEADERS = {
  'Content-Type': 'application/json',
  Accept: 'application/json',
  'User-Agent': 'Mozilla/5.0 (compatible; ScanApp/1.0)',
};
const RATE_LIMIT_DELAY = 220;

const settingsPrisma = new PrismaClient();

async function getToken() {
  try {
    const setting = await settingsPrisma.setting.findUnique({ where: { key: 'PENNYLANE_API_TOKEN' } });
    if (setting?.value?.trim()) return setting.value.trim();
  } catch {}
  return (process.env.PENNYLANE_API_TOKEN || '').trim() || null;
}

async function saveToken(token) {
  await settingsPrisma.setting.upsert({
    where: { key: 'PENNYLANE_API_TOKEN' },
    update: { value: token.trim() },
    create: { key: 'PENNYLANE_API_TOKEN', value: token.trim() },
  });
}

async function request(method, path, { body, params } = {}) {
  const token = await getToken();
  if (!token) throw new Error('Pennylane non configuré — token manquant');

  let url = `${BASE_URL}${path}`;
  if (params) {
    const qs = new URLSearchParams(params).toString();
    if (qs) url += `?${qs}`;
  }

  const options = {
    method,
    headers: { ...HEADERS, Authorization: `Bearer ${token}` },
  };
  if (body) options.body = JSON.stringify(body);

  const res = await fetch(url, options);

  if (res.status === 204) return null;

  if (!res.ok) {
    const text = await res.text();
    let msg = `Pennylane ${res.status}`;
    try { msg = JSON.parse(text).message || msg; } catch {}
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }

  return res.json();
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function testConnection() {
  const token = await getToken();
  if (!token) return { connected: false, error: 'Token manquant' };
  try {
    const data = await request('GET', '/supplier_invoices', { params: { limit: '1' } });
    console.log('[pennylane] testConnection raw keys:', Object.keys(data || {}));
    console.log('[pennylane] testConnection raw:', JSON.stringify(data).slice(0, 300));
    return {
      connected: true,
      responseKeys: Object.keys(data || {}),
      invoiceCount: data.total_invoices ?? data.total ?? data.pagination?.total ?? '?',
    };
  } catch (err) {
    return { connected: false, error: err.message };
  }
}

async function getSupplierInvoices({ filter, limit = 100, cursor } = {}) {
  const params = { limit: String(limit) };
  if (filter) params.filter = JSON.stringify(filter);
  if (cursor) params.cursor = cursor;
  const raw = await request('GET', '/supplier_invoices', { params });
  return {
    items: raw.items || raw.supplier_invoices || raw.data || [],
    has_more: raw.has_more ?? false,
    next_cursor: raw.next_cursor || null,
    _raw_keys: Object.keys(raw || {}),
  };
}

async function getSupplierInvoice(id) {
  return request('GET', `/supplier_invoices/${id}`);
}

async function getTransactions({ filter, limit = 100, cursor } = {}) {
  const params = { limit: String(limit) };
  if (filter) params.filter = JSON.stringify(filter);
  if (cursor) params.cursor = cursor;
  const raw = await request('GET', '/transactions', { params });
  return {
    items: raw.items || raw.transactions || raw.data || [],
    has_more: raw.has_more ?? false,
    next_cursor: raw.next_cursor || null,
    _raw_keys: Object.keys(raw || {}),
  };
}

async function getBankAccounts() {
  const raw = await request('GET', '/bank_accounts', { params: { limit: '100' } });
  return raw.items || raw.bank_accounts || raw.data || [];
}

async function getSavedBankAccountId() {
  try {
    const setting = await settingsPrisma.setting.findUnique({ where: { key: 'PENNYLANE_BANK_ACCOUNT_ID' } });
    return setting?.value?.trim() || null;
  } catch {}
  return null;
}

async function saveBankAccountId(id) {
  await settingsPrisma.setting.upsert({
    where: { key: 'PENNYLANE_BANK_ACCOUNT_ID' },
    update: { value: String(id) },
    create: { key: 'PENNYLANE_BANK_ACCOUNT_ID', value: String(id) },
  });
}

async function getMatchedTransactions(invoiceId) {
  return request('GET', `/supplier_invoices/${invoiceId}/matched_transactions`);
}

async function matchTransaction(invoiceId, transactionId) {
  return request('POST', `/supplier_invoices/${invoiceId}/matched_transactions`, {
    body: { transaction_id: transactionId },
  });
}

async function unmatchTransaction(invoiceId, transactionId) {
  return request('DELETE', `/supplier_invoices/${invoiceId}/matched_transactions`, {
    body: { transaction_id: transactionId },
  });
}

function scoreMatch(expense, invoice) {
  if (invoice.reconciled) return 0;

  let score = 0;

  // Filename match is the strongest signal — our app uploaded this exact file
  if (expense.file_name && invoice.filename) {
    if (invoice.filename === expense.file_name) return 100;
    const expBase = expense.file_name.replace('.pdf', '').toLowerCase();
    const invBase = invoice.filename.replace('.pdf', '').toLowerCase();
    if (expBase === invBase) return 100;
    if (invBase.includes(expBase) || expBase.includes(invBase)) score += 30;
  }

  const expenseAmount = Number(expense.amount);
  const invoiceAmount = Number(invoice.currency_amount || invoice.amount || 0);

  if (Math.abs(expenseAmount - invoiceAmount) < 0.02) score += 20;
  else if (Math.abs(expenseAmount - invoiceAmount) < 0.10) score += 10;

  const expDate = new Date(expense.date_ticket).getTime();
  const invDate = new Date(invoice.date).getTime();
  const daysDiff = Math.abs(expDate - invDate) / (1000 * 60 * 60 * 24);
  if (daysDiff < 1) score += 10;
  else if (daysDiff < 3) score += 5;
  else if (daysDiff < 5) score += 2;

  // Supplier name is in `label` field (e.g. "Facture LECLERC - ...")
  if (expense.merchant && invoice.label) {
    const expMerch = expense.merchant.toLowerCase();
    const invLabel = invoice.label.toLowerCase();
    if (invLabel.includes(expMerch) || expMerch.includes(invLabel)) score += 15;
    else {
      const expWords = expMerch.split(/\s+/).filter(w => w.length > 2);
      if (expWords.some(w => invLabel.includes(w))) score += 8;
    }
  }

  return score;
}

function scoreTransactionMatch(expense, transaction) {
  let score = 0;
  const expenseAmount = Number(expense.amount);
  const txAmount = Math.abs(Number(transaction.amount || transaction.currency_amount || 0));

  if (Math.abs(expenseAmount - txAmount) < 0.02) score += 20;
  else if (Math.abs(expenseAmount - txAmount) < 0.10) score += 10;

  const expDate = new Date(expense.date_ticket).getTime();
  const txDate = new Date(transaction.date).getTime();
  const daysDiff = Math.abs(expDate - txDate) / (1000 * 60 * 60 * 24);
  if (daysDiff < 1) score += 10;
  else if (daysDiff < 3) score += 5;

  if (expense.merchant && transaction.label) {
    const merchant = expense.merchant.toLowerCase().replace(/[^a-z0-9\s]/g, '');
    const label = transaction.label.toLowerCase().replace(/[^a-z0-9\s]/g, '');
    if (label.includes(merchant) || merchant.includes(label)) score += 15;
    else {
      const words = merchant.split(/\s+/).filter(w => w.length > 2);
      if (words.some(w => label.includes(w))) score += 8;
    }
  }

  return score;
}

async function findMatchingInvoice(expense, invoices) {
  let bestMatch = null;
  let bestScore = 0;

  for (const inv of invoices) {
    const s = scoreMatch(expense, inv);
    if (s > bestScore) {
      bestScore = s;
      bestMatch = inv;
    }
  }

  return bestScore >= 25 ? { invoice: bestMatch, score: bestScore } : null;
}

async function findMatchingTransaction(expense, transactions) {
  let bestMatch = null;
  let bestScore = 0;

  for (const tx of transactions) {
    const s = scoreTransactionMatch(expense, tx);
    if (s > bestScore) {
      bestScore = s;
      bestMatch = tx;
    }
  }

  return bestScore >= 25 ? { transaction: bestMatch, score: bestScore } : null;
}

module.exports = {
  getToken,
  saveToken,
  testConnection,
  getSupplierInvoices,
  getSupplierInvoice,
  getTransactions,
  getBankAccounts,
  getSavedBankAccountId,
  saveBankAccountId,
  getMatchedTransactions,
  matchTransaction,
  unmatchTransaction,
  scoreMatch,
  scoreTransactionMatch,
  findMatchingInvoice,
  findMatchingTransaction,
  sleep,
  RATE_LIMIT_DELAY,
};
