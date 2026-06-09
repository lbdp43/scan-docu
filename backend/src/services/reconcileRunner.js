/**
 * Cœur du rapprochement automatique (extrait de routes/pennylane.js pour être
 * réutilisable : route admin POST /pennylane/reconcile ET cron quotidien).
 *
 * Relie, dans Pennylane, les factures (issues de l'import Drive) aux transactions
 * bancaires correspondantes -> la compta se fait. Logique inchangée.
 */
const pennylane = require('./pennylane');

async function runReconcile(prisma) {
  const year = new Date().getFullYear();
  const fyStart = `${year}-01-01`;

  const expenses = await prisma.expense.findMany({
    where: { date_ticket: { gte: new Date(fyStart) } },
    omit: { receipt_image: true },
    include: { user: { select: { name: true, card_id: true } } },
    orderBy: { date_ticket: 'desc' },
  });

  if (expenses.length === 0) {
    return { message: 'Aucune dépense', results: [], diagnostics: {}, summary: { total: 0, matched: 0, alreadyReconciled: 0, noInvoice: 0, noTransaction: 0, errors: 0 } };
  }

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

  const reconciledInvoices = allInvoices.filter((i) => i.reconciled);
  const unreconciledInvoices = allInvoices.filter((i) => !i.reconciled);
  const expenseTransactions = allTransactions.filter((t) => Number(t.amount || t.currency_amount) < 0);

  const sampleInvoiceFilenames = allInvoices.slice(0, 10).map((i) => ({
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
      type: expense.type,
      amount: Number(expense.amount),
      date: expense.date_ticket,
      fileName: expense.file_name || null,
      userName,
      cardId,
    };

    if (expense.pennylane_matched) {
      results.push({ ...base, status: 'already_reconciled', message: 'Déjà rapproché', invoiceId: expense.pennylane_invoice_id });
      continue;
    }

    if (expense.file_name) {
      const alreadyReconciled = reconciledInvoices.find((i) =>
        i.filename === expense.file_name ||
        i.filename?.replace('.pdf', '').toLowerCase() === expense.file_name.replace('.pdf', '').toLowerCase()
      );
      if (alreadyReconciled) {
        await prisma.expense.update({
          where: { id: expense.id },
          data: { pennylane_invoice_id: String(alreadyReconciled.id), pennylane_matched: true },
        });
        results.push({ ...base, status: 'already_reconciled', message: 'Facture déjà rapprochée dans Pennylane', invoiceId: alreadyReconciled.id, invoiceFilename: alreadyReconciled.filename });
        continue;
      }
    }

    const availableInvoices = unreconciledInvoices.filter((i) => !usedInvoiceIds.has(i.id));
    const scored = availableInvoices.map((inv) => ({
      id: inv.id,
      filename: inv.filename,
      label: inv.label?.substring(0, 60),
      amount: inv.currency_amount || inv.amount,
      score: pennylane.scoreMatch(expense, inv),
    })).sort((a, b) => b.score - a.score);
    const top3 = scored.slice(0, 3);

    const invoiceMatch = scored[0]?.score >= 25 ? { invoice: availableInvoices.find((i) => i.id === scored[0].id), score: scored[0].score } : null;

    if (!invoiceMatch) {
      const availableTx = expenseTransactions.filter((t) => !usedTransactionIds.has(t.id));
      const txMatch = await pennylane.findMatchingTransaction(expense, availableTx);
      results.push({
        ...base,
        status: 'no_invoice',
        message: expense.file_name
          ? `Fichier "${expense.file_name}" non trouvé dans ${availableInvoices.length} factures non rapprochées`
          : 'Aucun file_name sur cette dépense (upload Drive manquant ?)',
        bestCandidates: top3,
        paymentFound: !!txMatch,
        paymentInfo: txMatch ? { amount: Math.abs(Number(txMatch.transaction.amount)), date: txMatch.transaction.date, label: txMatch.transaction.label, score: txMatch.score } : null,
      });
      continue;
    }

    const availableTx = expenseTransactions.filter((t) => !usedTransactionIds.has(t.id));
    const txMatch = await pennylane.findMatchingTransaction(expense, availableTx);

    if (!txMatch) {
      results.push({ ...base, status: 'no_transaction', message: `Facture trouvée (score ${invoiceMatch.score}) mais pas de transaction bancaire`, invoiceId: invoiceMatch.invoice.id, invoiceScore: invoiceMatch.score, invoiceFilename: invoiceMatch.invoice.filename });
      continue;
    }

    try {
      await pennylane.matchTransaction(invoiceMatch.invoice.id, txMatch.transaction.id);
      usedInvoiceIds.add(invoiceMatch.invoice.id);
      usedTransactionIds.add(txMatch.transaction.id);
      await prisma.expense.update({
        where: { id: expense.id },
        data: { pennylane_invoice_id: String(invoiceMatch.invoice.id), pennylane_matched: true },
      });
      results.push({ ...base, status: 'matched', invoiceId: invoiceMatch.invoice.id, transactionId: txMatch.transaction.id, invoiceScore: invoiceMatch.score, transactionScore: txMatch.score });
    } catch (matchErr) {
      console.error(`[pennylane] match error expense ${expense.id}:`, matchErr.message);
      results.push({ ...base, status: 'error', message: matchErr.message, invoiceId: invoiceMatch.invoice.id, invoiceFilename: invoiceMatch.invoice.filename, invoiceStatus: invoiceMatch.invoice.accounting_status, invoiceReconciled: invoiceMatch.invoice.reconciled, transactionId: txMatch.transaction.id, transactionLabel: txMatch.transaction.label });
    }

    await pennylane.sleep(pennylane.RATE_LIMIT_DELAY);
  }

  const matched = results.filter((r) => r.status === 'matched').length;
  const alreadyReconciled = results.filter((r) => r.status === 'already_reconciled').length;
  const noInvoice = results.filter((r) => r.status === 'no_invoice').length;
  const noTx = results.filter((r) => r.status === 'no_transaction').length;
  const errors = results.filter((r) => r.status === 'error').length;

  return {
    results,
    diagnostics: {
      totalInvoices: allInvoices.length,
      unreconciledInvoices: unreconciledInvoices.length,
      invoicePages,
      totalTransactions: allTransactions.length,
      expenseTransactions: expenseTransactions.length,
      sampleInvoices: sampleInvoiceFilenames,
      expensesWithFileName: expenses.filter((e) => e.file_name).length,
      expensesWithoutFileName: expenses.filter((e) => !e.file_name).length,
    },
    summary: { total: expenses.length, matched, alreadyReconciled, noInvoice, noTransaction: noTx, errors },
  };
}

module.exports = { runReconcile };
