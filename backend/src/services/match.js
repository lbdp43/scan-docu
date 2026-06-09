/**
 * Logique de matching PURE (aucune I/O) — isolée ici pour être testable
 * (cf. backend/test/match.test.js) et partagée par pennylane.js & missing.js.
 */

function dms(s) {
  const t = Date.parse(String(s).slice(0, 10));
  return Number.isNaN(t) ? null : t;
}

// Extrait { masked, last4, employee } d'une transaction Pennylane (compte pro).
function cardInfo(tx) {
  const pae = tx && tx.pro_account_expense ? tx.pro_account_expense : null;
  const masked = pae && pae.card_masked_number ? pae.card_masked_number : null;
  const emp = pae && pae.employee ? pae.employee : null;
  const employee = emp ? [emp.first_name, emp.last_name].filter(Boolean).join(' ') : null;
  return { masked, last4: masked ? masked.slice(-4) : null, employee };
}

// Un paiement (montant, date) a-t-il une facture Pennylane correspondante ?
// montant au centime ; facture datée de J-2 à J+25 par rapport au paiement.
function justifiedByInvoice(invoices, txAmount, txDate) {
  const td = dms(txDate);
  if (td == null) return false;
  for (const inv of invoices || []) {
    if (Math.abs(inv.amount - txAmount) > 0.01) continue;
    const idt = dms(inv.date);
    if (idt == null) continue;
    const dd = (td - idt) / 86400000;
    if (dd >= -2 && dd <= 25) return true;
  }
  return false;
}

// Score de correspondance dépense scan-docu <-> transaction (>=25 = match).
function expenseScore(expAmount, expDateMs, txAmount, txDateMs) {
  if (Math.abs(expAmount - txAmount) > 1) return 0;
  let s = 0;
  if (Math.abs(expAmount - txAmount) < 0.02) s += 30;
  else if (Math.abs(expAmount - txAmount) < 0.10) s += 15;
  else s += 5;
  if (expDateMs != null && txDateMs != null) {
    const dd = (txDateMs - expDateMs) / 86400000;
    if (dd >= -1 && dd <= 20) {
      if (dd < 2) s += 10; else if (dd < 7) s += 7; else if (dd < 15) s += 4; else s += 2;
    }
  }
  return s;
}

module.exports = { dms, cardInfo, justifiedByInvoice, expenseScore };
