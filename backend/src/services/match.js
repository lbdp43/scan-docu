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

// 1 justificatif = 1 paiement.
// Un ticket scanné existe en double : la dépense scan-docu ET la facture Pennylane
// issue du même PDF Drive. On les fusionne en une seule "unité" (même nom de
// fichier), puis chaque unité ne peut justifier qu'UNE transaction — fini le ticket
// unique qui justifie deux paiements de même montant.
// txs: [{id, amount, dateMs}] · expenses: [{amount, dateMs, fileName}]
// invoices: [{amount, dateMs, filename}] -> Set des ids de transactions justifiées.
function assignJustified(txs, expenses, invoices) {
  const units = [];
  const claimed = new Set();
  for (const e of expenses) {
    const unit = { exp: e, inv: null };
    if (e.fileName) {
      const i = invoices.findIndex((inv, idx) => !claimed.has(idx) && inv.filename && inv.filename === e.fileName);
      if (i !== -1) { unit.inv = invoices[i]; claimed.add(i); }
    }
    units.push(unit);
  }
  invoices.forEach((inv, idx) => { if (!claimed.has(idx)) units.push({ exp: null, inv }); });

  const justified = new Set();
  const used = new Set();

  // Phase 1 — côté ticket (scoring riche), meilleures paires servies d'abord
  const expPairs = [];
  txs.forEach((t) => units.forEach((u, ui) => {
    if (!u.exp) return;
    const s = expenseScore(u.exp.amount, u.exp.dateMs, t.amount, t.dateMs);
    if (s >= 25) expPairs.push({ t, ui, s });
  }));
  expPairs.sort((a, b) => b.s - a.s);
  for (const p of expPairs) {
    if (justified.has(p.t.id) || used.has(p.ui)) continue;
    justified.add(p.t.id);
    used.add(p.ui);
  }

  // Phase 2 — côté facture (montant au centime, J-2..J+25), dates les plus proches d'abord
  const invPairs = [];
  txs.forEach((t) => units.forEach((u, ui) => {
    if (!u.inv || used.has(ui)) return;
    if (Math.abs(u.inv.amount - t.amount) > 0.01) return;
    if (u.inv.dateMs == null || t.dateMs == null) return;
    const dd = (t.dateMs - u.inv.dateMs) / 86400000;
    if (dd >= -2 && dd <= 25) invPairs.push({ t, ui, d: Math.abs(dd) });
  }));
  invPairs.sort((a, b) => a.d - b.d);
  for (const p of invPairs) {
    if (justified.has(p.t.id) || used.has(p.ui)) continue;
    justified.add(p.t.id);
    used.add(p.ui);
  }

  return justified;
}

module.exports = { dms, cardInfo, justifiedByInvoice, expenseScore, assignJustified };
