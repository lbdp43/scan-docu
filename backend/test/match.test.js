const test = require('node:test');
const assert = require('node:assert');
const { cardInfo, justifiedByInvoice, expenseScore } = require('../src/services/match');

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
