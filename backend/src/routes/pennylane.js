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

// GET /api/pennylane/invoices — List supplier invoices from Pennylane
router.get('/invoices', async (req, res) => {
  try {
    const { status: invStatus, limit, cursor } = req.query;
    const filter = [];
    if (invStatus) filter.push({ field: 'status', operator: 'eq', value: invStatus });
    const data = await pennylane.getSupplierInvoices({
      filter: filter.length ? filter : undefined,
      limit: parseInt(limit) || 50,
      cursor: cursor || undefined,
    });
    res.json(data);
  } catch (err) {
    console.error('[pennylane] invoices error:', err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
});

// GET /api/pennylane/transactions — List bank transactions from Pennylane
router.get('/transactions', async (req, res) => {
  try {
    const { date_from, date_to, limit, cursor } = req.query;
    const filter = [];
    if (date_from) filter.push({ field: 'date', operator: 'gteq', value: date_from });
    if (date_to) filter.push({ field: 'date', operator: 'lteq', value: date_to });
    const data = await pennylane.getTransactions({
      filter: filter.length ? filter : undefined,
      limit: parseInt(limit) || 50,
      cursor: cursor || undefined,
    });
    res.json(data);
  } catch (err) {
    console.error('[pennylane] transactions error:', err.message);
    res.status(err.status || 500).json({ error: err.message });
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
      include: { user: { select: { name: true } } },
      orderBy: { date_ticket: 'desc' },
      take: 100,
    });

    if (expenses.length === 0) {
      return res.json({ message: 'Aucune dépense à rapprocher', results: [] });
    }

    const dateMin = new Date(Math.min(...expenses.map(e => new Date(e.date_ticket).getTime())));
    const dateMax = new Date(Math.max(...expenses.map(e => new Date(e.date_ticket).getTime())));
    dateMin.setDate(dateMin.getDate() - 5);
    dateMax.setDate(dateMax.getDate() + 5);

    const invoiceFilter = [
      { field: 'date', operator: 'gteq', value: dateMin.toISOString().slice(0, 10) },
      { field: 'date', operator: 'lteq', value: dateMax.toISOString().slice(0, 10) },
    ];
    const txFilter = [
      { field: 'date', operator: 'gteq', value: dateMin.toISOString().slice(0, 10) },
      { field: 'date', operator: 'lteq', value: dateMax.toISOString().slice(0, 10) },
    ];

    let allInvoices = [];
    let invoiceCursor;
    do {
      const batch = await pennylane.getSupplierInvoices({ filter: invoiceFilter, limit: 100, cursor: invoiceCursor });
      const items = batch.supplier_invoices || batch.invoices || batch.data || [];
      allInvoices = allInvoices.concat(items);
      invoiceCursor = batch.pagination?.cursor || batch.cursor;
      await pennylane.sleep(pennylane.RATE_LIMIT_DELAY);
    } while (invoiceCursor);

    let allTransactions = [];
    let txCursor;
    do {
      const batch = await pennylane.getTransactions({ filter: txFilter, limit: 100, cursor: txCursor });
      const items = batch.transactions || batch.data || [];
      allTransactions = allTransactions.concat(items);
      txCursor = batch.pagination?.cursor || batch.cursor;
      await pennylane.sleep(pennylane.RATE_LIMIT_DELAY);
    } while (txCursor);

    const results = [];
    const usedInvoiceIds = new Set();
    const usedTransactionIds = new Set();

    for (const expense of expenses) {
      const availableInvoices = allInvoices.filter(i => !usedInvoiceIds.has(i.id));
      const invoiceMatch = await pennylane.findMatchingInvoice(expense, availableInvoices);

      if (!invoiceMatch) {
        results.push({
          expenseId: expense.id,
          merchant: expense.merchant,
          amount: Number(expense.amount),
          date: expense.date_ticket,
          status: 'no_invoice',
          message: 'Aucune facture Pennylane correspondante',
        });
        continue;
      }

      const availableTx = allTransactions.filter(t => !usedTransactionIds.has(t.id));
      const txMatch = await pennylane.findMatchingTransaction(expense, availableTx);

      if (!txMatch) {
        results.push({
          expenseId: expense.id,
          merchant: expense.merchant,
          amount: Number(expense.amount),
          date: expense.date_ticket,
          status: 'no_transaction',
          message: 'Facture trouvée mais pas de transaction bancaire correspondante',
          invoiceId: invoiceMatch.invoice.id,
          invoiceScore: invoiceMatch.score,
        });
        continue;
      }

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
          expenseId: expense.id,
          merchant: expense.merchant,
          amount: Number(expense.amount),
          date: expense.date_ticket,
          status: 'matched',
          invoiceId: invoiceMatch.invoice.id,
          transactionId: txMatch.transaction.id,
          invoiceScore: invoiceMatch.score,
          transactionScore: txMatch.score,
        });
      } catch (matchErr) {
        results.push({
          expenseId: expense.id,
          merchant: expense.merchant,
          amount: Number(expense.amount),
          date: expense.date_ticket,
          status: 'error',
          message: matchErr.message,
          invoiceId: invoiceMatch.invoice.id,
          transactionId: txMatch.transaction.id,
        });
      }

      await pennylane.sleep(pennylane.RATE_LIMIT_DELAY);
    }

    const matched = results.filter(r => r.status === 'matched').length;
    const noInvoice = results.filter(r => r.status === 'no_invoice').length;
    const noTx = results.filter(r => r.status === 'no_transaction').length;
    const errors = results.filter(r => r.status === 'error').length;

    res.json({
      results,
      summary: { total: expenses.length, matched, noInvoice, noTransaction: noTx, errors },
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
