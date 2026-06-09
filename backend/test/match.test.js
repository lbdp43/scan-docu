const test = require('node:test');
const assert = require('node:assert');
const { cardInfo, justifiedByInvoice, expenseScore, assignJustified } = require('../src/services/match');

const ms = (d) => Date.parse(d);

test('cardInfo extrait carte + dernier 4 + employé', () => {
  const tx = { pro_account_expense: { card_masked_number: '543946XXXXXX6945', employee: { first_name: 'Guillaume', last_name: 'Poret' } } };
  const ci = cardInfo(tx);
  assert.strictEqual(ci.masked, '543946XXXXXX6945');
  assert.strictEqual(ci.last4, '6945');
  assert.strictEqual(ci.employee, 'Guillaume Poret');
});

test('cardInfo sans pro_account_expense -> nulls', () => {
  const ci = cardInfo({});
  assert.strictEqual(ci.masked, null);
  assert.strictEqual(ci.last4, null);
  assert.strictEqual(ci.employee, null);
});

test('justifiedByInvoice: montant exact + date J+1 -> true', () => {
  assert.strictEqual(justifiedByInvoice([{ amount: 81.84, date: '2026-05-13' }], 81.84, '2026-05-14'), true);
});

test('justifiedByInvoice: montant différent -> false', () => {
  assert.strictEqual(justifiedByInvoice([{ amount: 81.84, date: '2026-05-13' }], 50.0, '2026-05-14'), false);
});

test('justifiedByInvoice: date trop loin -> false', () => {
  assert.strictEqual(justifiedByInvoice([{ amount: 10, date: '2026-01-01' }], 10, '2026-03-01'), false);
});

test('justifiedByInvoice: paiement bien avant la facture -> false', () => {
  assert.strictEqual(justifiedByInvoice([{ amount: 10, date: '2026-05-20' }], 10, '2026-05-01'), false);
});

test('expenseScore: montant exact + lendemain >= 25 (match)', () => {
  assert.ok(expenseScore(20.0, ms('2026-03-10'), 20.0, ms('2026-03-11')) >= 25);
});

test('expenseScore: montant très différent = 0', () => {
  assert.strictEqual(expenseScore(20.0, ms('2026-03-10'), 99.0, ms('2026-03-11')), 0);
});

// --- assignJustified : 1 justificatif = 1 paiement ---

test('1 ticket ne justifie qu\'UN des 2 paiements identiques (2 pleins à 80€)', () => {
  const txs = [
    { id: 1, amount: 80, dateMs: ms('2026-03-10') },
    { id: 2, amount: 80, dateMs: ms('2026-03-10') },
  ];
  const expenses = [{ amount: 80, dateMs: ms('2026-03-10'), fileName: 't.pdf' }];
  const j = assignJustified(txs, expenses, []);
  assert.strictEqual(j.size, 1);
});

test('ticket + facture du MÊME document (même fichier) = 1 seule unité -> 1 paiement', () => {
  const txs = [
    { id: 1, amount: 80, dateMs: ms('2026-03-10') },
    { id: 2, amount: 80, dateMs: ms('2026-03-10') },
  ];
  const expenses = [{ amount: 80, dateMs: ms('2026-03-10'), fileName: 't.pdf' }];
  const invoices = [{ amount: 80, dateMs: ms('2026-03-10'), filename: 't.pdf' }];
  const j = assignJustified(txs, expenses, invoices);
  assert.strictEqual(j.size, 1); // la facture issue du même PDF ne compte pas double
});

test('2 justificatifs distincts justifient bien 2 paiements', () => {
  const txs = [
    { id: 1, amount: 80, dateMs: ms('2026-03-10') },
    { id: 2, amount: 80, dateMs: ms('2026-03-11') },
  ];
  const expenses = [{ amount: 80, dateMs: ms('2026-03-10'), fileName: 'a.pdf' }];
  const invoices = [{ amount: 80, dateMs: ms('2026-03-11'), filename: 'b.pdf' }];
  const j = assignJustified(txs, expenses, invoices);
  assert.strictEqual(j.size, 2);
});

test('le meilleur match (date la plus proche) est servi en premier', () => {
  const txs = [
    { id: 1, amount: 20, dateMs: ms('2026-03-10') },  // lendemain du ticket
    { id: 2, amount: 20, dateMs: ms('2026-03-25') },  // 16 jours après
  ];
  const expenses = [{ amount: 20, dateMs: ms('2026-03-09'), fileName: null }];
  const j = assignJustified(txs, expenses, []);
  assert.ok(j.has(1));
  assert.ok(!j.has(2));
});

test('facture seule (fournisseur, sans ticket scan-docu) justifie un paiement', () => {
  const txs = [{ id: 1, amount: 12.9, dateMs: ms('2026-05-08') }];
  const j = assignJustified(txs, [], [{ amount: 12.9, dateMs: ms('2026-05-07'), filename: 'f.pdf' }]);
  assert.ok(j.has(1));
});

// Régression du bug "Cannot read properties of null (reading id)" :
// un paiement peut être justifié par une FACTURE sans aucune dépense scan-docu.
test('regression: justifié par facture sans dépense (bestExpense=null)', () => {
  const invoices = [{ amount: 12.9, date: '2026-05-07' }];
  const expenses = [];
  const a = 12.9, tdms = ms('2026-05-08');
  const hasExpense = expenses.some((e) => expenseScore(e.amount, e.dateMs, a, tdms) >= 25);
  const matched = hasExpense || justifiedByInvoice(invoices, a, '2026-05-08');
  assert.strictEqual(hasExpense, false); // aucune dépense -> côté route, bestExpense reste null
  assert.strictEqual(matched, true); // mais le paiement est bien justifié (facture)
});
