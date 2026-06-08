const express = require('express');
const { authenticateToken, checkAdmin } = require('../middleware/auth');
const pennylane = require('../services/pennylane');

const router = express.Router();

router.use(authenticateToken);
router.use(checkAdmin);

// GET /api/pennylane/status — Test Pennylane connection
router.get('/status', async (req, res) => {
  try {
    const status = await pennylane.testConnection();
    res.json(status);
  } catch (err) {
    res.json({ connected: false, error: err.message });
  }
});

// POST /api/pennylane/config — Save Pennylane API token
router.post('/config', async (req, res) => {
  try {
    const { token } = req.body;
    if (!token?.trim()) return res.status(400).json({ error: 'Token requis' });
    await pennylane.saveToken(token);
    const status = await pennylane.testConnection();
    res.json({ saved: true, ...status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/pennylane/bank-accounts — List bank accounts from Pennylane
router.get('/bank-accounts', async (req, res) => {
  try {
    const accounts = await pennylane.getBankAccounts();
    const savedId = await pennylane.getSavedBankAccountId();
    res.json({ accounts, selectedId: savedId });
  } catch (err) {
    console.error('[pennylane] bank-accounts error:', err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
});

// POST /api/pennylane/bank-accounts — Save selected bank account
router.post('/bank-accounts', async (req, res) => {
  try {
    const { accountId } = req.body;
    if (!accountId) return res.status(400).json({ error: 'accountId requis' });
    await pennylane.saveBankAccountId(accountId);
    res.json({ success: true, selectedId: String(accountId) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/pennylane/invoices — List supplier invoices from Pennylane (all pages)
router.get('/invoices', async (req, res) => {
  try {
    const { status: invStatus, date_from, date_to, limit } = req.query;
    const filter = [];
    if (invStatus) filter.push({ field: 'status', operator: 'eq', value: invStatus });
    if (date_from) filter.push({ field: 'date', operator: 'gteq', value: date_from });
    if (date_to) filter.push({ field: 'date', operator: 'lteq', value: date_to });

    let allItems = [];
    let nextCursor;
    const pageLimit = parseInt(limit) || 100;

    do {
      const batch = await pennylane.getSupplierInvoices({
        filter: filter.length ? filter : undefined,
        limit: pageLimit,
        cursor: nextCursor,
      });
      allItems = allItems.concat(batch.items);
      nextCursor = batch.has_more ? batch.next_cursor : null;
      if (nextCursor) await pennylane.sleep(pennylane.RATE_LIMIT_DELAY);
    } while (nextCursor);

    res.json({ items: allItems, has_more: false, total: allItems.length });
  } catch (err) {
    console.error('[pennylane] invoices error:', err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
});

// GET /api/pennylane/invoices/:id — Get single invoice detail (includes file_url)
router.get('/invoices/:id', async (req, res) => {
  try {
    const invoice = await pennylane.getSupplierInvoice(req.params.id);
    res.json(invoice);
  } catch (err) {
    console.error('[pennylane] invoice detail error:', err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
});

// GET /api/pennylane/transactions — List bank transactions from Pennylane
router.get('/transactions', async (req, res) => {
  try {
    const { date_from, date_to, expenses_only, bank_account_id, limit, cursor } = req.query;
    const filter = [];
    if (date_from) filter.push({ field: 'date', operator: 'gteq', value: date_from });
    if (date_to) filter.push({ field: 'date', operator: 'lteq', value: date_to });

    // Use saved bank account if none specified
    const bankId = bank_account_id || await pennylane.getSavedBankAccountId();
    if (bankId) filter.push({ field: 'bank_account_id', operator: 'eq', value: bankId });

    let allItems = [];
    let nextCursor = cursor || undefined;
    const pageLimit = parseInt(limit) || 100;

    // Paginate to get all transactions in the date range
    do {
      const batch = await pennylane.getTransactions({
        filter: filter.length ? filter : undefined,
        limit: pageLimit,
        cursor: nextCursor,
      });
      allItems = allItems.concat(batch.items);
      nextCursor = batch.has_more ? batch.next_cursor : null;
      if (nextCursor) await pennylane.sleep(pennylane.RATE_LIMIT_DELAY);
    } while (nextCursor);

    // Filter to only expenses (negative amounts) if requested
    if (expenses_only === 'true') {
      allItems = allItems.filter(t => Number(t.amount || t.currency_amount) < 0);
    }

    res.json({ items: allItems, has_more: false, total: allItems.length });
  } catch (err) {
    console.error('[pennylane] transactions error:', err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
});

// GET /api/pennylane/debug — Raw API responses for debugging
router.get('/debug', async (req, res) => {
  try {
    const invoicesRaw = await pennylane.getSupplierInvoices({ limit: 2 });
    await pennylane.sleep(pennylane.RATE_LIMIT_DELAY);
    const txRaw = await pennylane.getTransactions({ limit: 2 });
    res.json({
      invoices: { keys: Object.keys(invoicesRaw || {}), raw: invoicesRaw },
      transactions: { keys: Object.keys(txRaw || {}), raw: txRaw },
    });
  } catch (err) {
    res.status(500).json({ error: err.message, stack: err.stack?.split('\n').slice(0, 3) });
  }
});

// GET /api/pennylane/unmatched — Find unmatched expenses (our DB) that could be reconciled
router.get('/unmatched', async (req, res) => {
  try {
    const expenses = await req.prisma.expense.findMany({
      where: {
        pennylane_matched: false,
        upload_status: 'uploaded',
      },
      omit: { receipt_image: true },
      include: { user: { select: { name: true, card_id: true } } },
      orderBy: { date_ticket: 'desc' },
      take: 100,
    });
    res.json({ expenses, count: expenses.length });
  } catch (err) {
    console.error('[pennylane] unmatched error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/pennylane/reconcile — Auto-reconcile unmatched expenses
router.post('/reconcile', async (req, res) => {
  try {
    const expenses = await req.prisma.expense.findMany({
      where: {
        pennylane_matched: false,
        upload_status: 'uploaded',
      },
      omit: { receipt_image: true },
      include: { user: { select: { name: true, card_id: true } } },
      orderBy: { date_ticket: 'desc' },
      take: 100,
    });

    if (expenses.length === 0) {
      return res.json({ message: 'Aucune dépense à rapprocher', results: [], diagnostics: {}, summary: { total: 0, matched: 0, noInvoice: 0, noTransaction: 0, errors: 0 } });
    }

    const year = new Date().getFullYear();
    const fyStart = `${year}-01-01`;
    const fyEnd = `${year}-12-31`;

    const invoiceFilter = [
      { field: 'date', operator: 'gteq', value: fyStart },
      { field: 'date', operator: 'lteq', value: fyEnd },
    ];
    const txFilter = [
      { field: 'date', operator: 'gteq', value: fyStart },
      { field: 'date', operator: 'lteq', value: fyEnd },
    ];
    const savedBankId = await pennylane.getSavedBankAccountId();
    if (savedBankId) txFilter.push({ field: 'bank_account_id', operator: 'eq', value: savedBankId });

    let allInvoices = [];
    let invoiceCursor;
    let invoicePages = 0;
    do {
      const batch = await pennylane.getSupplierInvoices({ filter: invoiceFilter, limit: 100, cursor: invoiceCursor });
      allInvoices = allInvoices.concat(batch.items);
      invoiceCursor = batch.has_more ? batch.next_cursor : null;
      invoicePages++;
      await pennylane.sleep(pennylane.RATE_LIMIT_DELAY);
    } while (invoiceCursor);

    let allTransactions = [];
    let txCursor;
    do {
      const batch = await pennylane.getTransactions({ filter: txFilter, limit: 100, cursor: txCursor });
      allTransactions = allTransactions.concat(batch.items);
      txCursor = batch.has_more ? batch.next_cursor : null;
      await pennylane.sleep(pennylane.RATE_LIMIT_DELAY);
    } while (txCursor);

    const reconciledInvoices = allInvoices.filter(i => i.reconciled);
    const unreconciledInvoices = allInvoices.filter(i => !i.reconciled);
    const expenseTransactions = allTransactions.filter(t => Number(t.amount || t.currency_amount) < 0);

    console.log(`[pennylane] reconcile: ${allInvoices.length} invoices (${unreconciledInvoices.length} unreconciled, ${reconciledInvoices.length} reconciled) in ${invoicePages} pages, ${allTransactions.length} transactions (${expenseTransactions.length} expense-type)`);

    const sampleInvoiceFilenames = allInvoices.slice(0, 10).map(i => ({
      id: i.id,
      filename: i.filename,
      label: i.label,
      amount: i.currency_amount || i.amount,
      date: i.date,
      reconciled: i.reconciled,
    }));

    const results = [];
    const usedInvoiceIds = new Set();
    const usedTransactionIds = new Set();

    for (const expense of expenses) {
      const userName = expense.user?.name || '?';
      const cardId = expense.card_id || expense.user?.card_id || null;
      const base = {
        expenseId: expense.id,
        merchant: expense.merchant,
        amount: Number(expense.amount),
        date: expense.date_ticket,
        fileName: expense.file_name || null,
        userName,
        cardId,
      };

      // Step 1: Check if invoice already reconciled in Pennylane (filename match)
      if (expense.file_name) {
        const alreadyReconciled = reconciledInvoices.find(i =>
          i.filename === expense.file_name ||
          i.filename?.replace('.pdf', '').toLowerCase() === expense.file_name.replace('.pdf', '').toLowerCase()
        );
        if (alreadyReconciled) {
          await req.prisma.expense.update({
            where: { id: expense.id },
            data: {
              pennylane_invoice_id: String(alreadyReconciled.id),
              pennylane_matched: true,
            },
          });
          results.push({
            ...base,
            status: 'already_reconciled',
            message: 'Facture déjà rapprochée dans Pennylane',
            invoiceId: alreadyReconciled.id,
            invoiceFilename: alreadyReconciled.filename,
          });
          continue;
        }
      }

      // Step 2: Try to match with unreconciled invoices
      const availableInvoices = unreconciledInvoices.filter(i => !usedInvoiceIds.has(i.id));

      const scored = availableInvoices.map(inv => ({
        id: inv.id,
        filename: inv.filename,
        label: inv.label?.substring(0, 60),
        amount: inv.currency_amount || inv.amount,
        score: pennylane.scoreMatch(expense, inv),
      })).sort((a, b) => b.score - a.score);
      const top3 = scored.slice(0, 3);

      const invoiceMatch = scored[0]?.score >= 25 ? { invoice: availableInvoices.find(i => i.id === scored[0].id), score: scored[0].score } : null;

      if (!invoiceMatch) {
        // Still look for a matching bank transaction to show payment status
        const availableTx = expenseTransactions.filter(t => !usedTransactionIds.has(t.id));
        const txMatch = await pennylane.findMatchingTransaction(expense, availableTx);
        results.push({
          ...base,
          status: 'no_invoice',
          message: expense.file_name
            ? `Fichier "${expense.file_name}" non trouvé dans ${availableInvoices.length} factures non rapprochées`
            : 'Aucun file_name sur cette dépense (upload Drive manquant ?)',
          bestCandidates: top3,
          paymentFound: !!txMatch,
          paymentInfo: txMatch ? {
            amount: Math.abs(Number(txMatch.transaction.amount)),
            date: txMatch.transaction.date,
            label: txMatch.transaction.label,
            score: txMatch.score,
          } : null,
        });
        continue;
      }

      // Step 3: Find matching transaction
      const availableTx = expenseTransactions.filter(t => !usedTransactionIds.has(t.id));
      const txMatch = await pennylane.findMatchingTransaction(expense, availableTx);

      if (!txMatch) {
        results.push({
          ...base,
          status: 'no_transaction',
          message: `Facture trouvée (score ${invoiceMatch.score}) mais pas de transaction bancaire`,
          invoiceId: invoiceMatch.invoice.id,
          invoiceScore: invoiceMatch.score,
          invoiceFilename: invoiceMatch.invoice.filename,
        });
        continue;
      }

      // Step 4: Reconcile via Pennylane API
      try {
        await pennylane.matchTransaction(invoiceMatch.invoice.id, txMatch.transaction.id);
        usedInvoiceIds.add(invoiceMatch.invoice.id);
        usedTransactionIds.add(txMatch.transaction.id);

        await req.prisma.expense.update({
          where: { id: expense.id },
          data: {
            pennylane_invoice_id: String(invoiceMatch.invoice.id),
            pennylane_matched: true,
          },
        });

        results.push({
          ...base,
          status: 'matched',
          invoiceId: invoiceMatch.invoice.id,
          transactionId: txMatch.transaction.id,
          invoiceScore: invoiceMatch.score,
          transactionScore: txMatch.score,
        });
      } catch (matchErr) {
        console.error(`[pennylane] match error expense ${expense.id}:`, matchErr.message);
        results.push({
          ...base,
          status: 'error',
          message: matchErr.message,
          invoiceId: invoiceMatch.invoice.id,
          invoiceFilename: invoiceMatch.invoice.filename,
          invoiceStatus: invoiceMatch.invoice.accounting_status,
          invoiceReconciled: invoiceMatch.invoice.reconciled,
          transactionId: txMatch.transaction.id,
          transactionLabel: txMatch.transaction.label,
        });
      }

      await pennylane.sleep(pennylane.RATE_LIMIT_DELAY);
    }

    const matched = results.filter(r => r.status === 'matched').length;
    const alreadyReconciled = results.filter(r => r.status === 'already_reconciled').length;
    const noInvoice = results.filter(r => r.status === 'no_invoice').length;
    const noTx = results.filter(r => r.status === 'no_transaction').length;
    const errors = results.filter(r => r.status === 'error').length;

    res.json({
      results,
      diagnostics: {
        totalInvoices: allInvoices.length,
        unreconciledInvoices: unreconciledInvoices.length,
        invoicePages,
        totalTransactions: allTransactions.length,
        expenseTransactions: expenseTransactions.length,
        sampleInvoices: sampleInvoiceFilenames,
        expensesWithFileName: expenses.filter(e => e.file_name).length,
        expensesWithoutFileName: expenses.filter(e => !e.file_name).length,
      },
      summary: { total: expenses.length, matched, alreadyReconciled, noInvoice, noTransaction: noTx, errors },
    });
  } catch (err) {
    console.error('[pennylane] reconcile error:', err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
});

// POST /api/pennylane/match — Manual match: link a specific expense to invoice + transaction
router.post('/match', async (req, res) => {
  try {
    const { expenseId, invoiceId, transactionId } = req.body;
    if (!expenseId || !invoiceId || !transactionId) {
      return res.status(400).json({ error: 'expenseId, invoiceId et transactionId requis' });
    }

    await pennylane.matchTransaction(invoiceId, transactionId);

    await req.prisma.expense.update({
      where: { id: parseInt(expenseId) },
      data: {
        pennylane_invoice_id: String(invoiceId),
        pennylane_matched: true,
      },
    });

    res.json({ success: true });
  } catch (err) {
    console.error('[pennylane] match error:', err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
});

// POST /api/pennylane/unmatch/:id — Undo reconciliation for an expense
router.post('/unmatch/:id', async (req, res) => {
  try {
    const expenseId = parseInt(req.params.id, 10);
    if (isNaN(expenseId)) return res.status(400).json({ error: 'ID invalide' });

    const expense = await req.prisma.expense.findUnique({ where: { id: expenseId } });
    if (!expense) return res.status(404).json({ error: 'Dépense non trouvée' });
    if (!expense.pennylane_invoice_id) return res.status(400).json({ error: 'Pas de rapprochement Pennylane' });

    const { transactionId } = req.body;
    if (transactionId) {
      await pennylane.unmatchTransaction(expense.pennylane_invoice_id, transactionId);
    }

    await req.prisma.expense.update({
      where: { id: expenseId },
      data: { pennylane_invoice_id: null, pennylane_matched: false },
    });

    res.json({ success: true });
  } catch (err) {
    console.error('[pennylane] unmatch error:', err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;
