/**
 * Logique de rapprochement (pure, sans I/O — testable seule).
 *
 * Croise les transactions carte Pennylane (compte Pro) avec les justificatifs
 * scannés dans scan-docu, pour identifier, par carte :
 *   - les paiements rapprochés (justificatif scanné trouvé)
 *   - les paiements MANQUANTS (aucun justificatif scanné)
 * et les scans orphelins (scannés sans transaction correspondante).
 *
 * Le rapprochement se fait sur : montant (à 1 centime près) + date (± toleranceDays),
 * en privilégiant la même carte quand le mapping carte->scan_card_id est renseigné.
 */

const DEFAULT_TOLERANCE_DAYS = 4;

function toDateOnly(d) {
  const date = d instanceof Date ? d : new Date(d);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function daysBetween(a, b) {
  const ms = Math.abs(toDateOnly(a).getTime() - toDateOnly(b).getTime());
  return Math.round(ms / 86400000);
}

function amountsEqual(a, b) {
  return Math.abs(Number(a) - Number(b)) < 0.005;
}

/**
 * @param {Object} params
 * @param {Array} params.transactions  transactions Pennylane normalisées (voir pennylane.js)
 * @param {Array} params.expenses      dépenses scan-docu [{id, amount, date_ticket, card_id, merchant, user_name, drive_file_url, has_receipt}]
 * @param {Array} params.mappings      [{masked_number, last4, label, scan_card_id}]
 * @param {number} [params.toleranceDays]
 */
function reconcile({ transactions, expenses, mappings = [], toleranceDays = DEFAULT_TOLERANCE_DAYS }) {
  const mapByMasked = new Map();
  for (const m of mappings) {
    if (m.masked_number) mapByMasked.set(m.masked_number, m);
  }

  // On ne rapproche que les sorties (dépenses) carte.
  const txns = transactions
    .filter((t) => t.isExpense && t.cardMasked)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  // Pool de dépenses scannées consommables (une seule fois chacune).
  const pool = expenses.map((e) => ({
    ...e,
    _amount: Number(e.amount),
    _consumed: false,
  }));

  function findMatch(txn) {
    const mapping = mapByMasked.get(txn.cardMasked);
    const wantCard = mapping?.scan_card_id || null;

    const candidates = pool.filter(
      (e) => !e._consumed
        && amountsEqual(e._amount, txn.absAmount)
        && daysBetween(e.date_ticket, txn.date) <= toleranceDays
    );
    if (candidates.length === 0) return null;

    // 1) Même carte si on connaît le lien, 2) sinon la date la plus proche.
    const score = (e) => {
      const sameCard = wantCard && e.card_id === wantCard ? 0 : 1;
      return [sameCard, daysBetween(e.date_ticket, txn.date)];
    };
    candidates.sort((a, b) => {
      const sa = score(a);
      const sb = score(b);
      return sa[0] - sb[0] || sa[1] - sb[1];
    });
    return candidates[0];
  }

  // Regroupement par carte
  const cards = new Map();
  function cardBucket(txn) {
    if (!cards.has(txn.cardMasked)) {
      const mapping = mapByMasked.get(txn.cardMasked);
      cards.set(txn.cardMasked, {
        mapping_id: mapping?.id || null,
        masked_number: txn.cardMasked,
        last4: txn.cardLast4,
        label: mapping?.label || null,
        scan_card_id: mapping?.scan_card_id || null,
        employee: txn.employee || null,
        transactions: 0,
        matched: 0,
        missing: 0,
        amount_total: 0,
        amount_missing: 0,
        missing_list: [],
      });
    }
    return cards.get(txn.cardMasked);
  }

  for (const txn of txns) {
    const bucket = cardBucket(txn);
    bucket.transactions += 1;
    bucket.amount_total = +(bucket.amount_total + txn.absAmount).toFixed(2);

    const match = findMatch(txn);
    if (match) {
      match._consumed = true;
      bucket.matched += 1;
    } else {
      bucket.missing += 1;
      bucket.amount_missing = +(bucket.amount_missing + txn.absAmount).toFixed(2);
      bucket.missing_list.push({
        transaction_id: txn.id,
        date: txn.date,
        amount: txn.absAmount,
        label: txn.label,
        employee: txn.employee,
      });
    }
  }

  // Scans non rapprochés à une transaction (orphelins).
  const orphanScans = pool
    .filter((e) => !e._consumed)
    .map((e) => ({
      id: e.id,
      date: e.date_ticket,
      amount: e._amount,
      merchant: e.merchant || null,
      card_id: e.card_id || null,
      user_name: e.user_name || null,
      drive_file_url: e.drive_file_url || null,
    }));

  const cardList = [...cards.values()].sort((a, b) => b.missing - a.missing);
  const totals = cardList.reduce(
    (acc, c) => {
      acc.transactions += c.transactions;
      acc.matched += c.matched;
      acc.missing += c.missing;
      acc.amount_missing = +(acc.amount_missing + c.amount_missing).toFixed(2);
      return acc;
    },
    { transactions: 0, matched: 0, missing: 0, amount_missing: 0, orphan_scans: orphanScans.length }
  );

  return { totals, cards: cardList, orphanScans, toleranceDays };
}

module.exports = { reconcile, daysBetween, amountsEqual, DEFAULT_TOLERANCE_DAYS };
