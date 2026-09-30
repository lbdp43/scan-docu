/**
 * Débits du compte pro (relevé bancaire Pennylane) enrichis : carte, intitulé
 * de carte, titulaire attribué, véhicule, catégorie « nature ».
 * Partagé par la page Stats et le connecteur MCP.
 */
const pennylane = require('./pennylane');
const { VEHICLE_CATEGORIES } = require('./categorize');

const CACHE_MS = 5 * 60 * 1000;
const cache = new Map();

async function fetchDebits(from, to) {
  const filter = [
    { field: 'date', operator: 'gteq', value: from },
    { field: 'date', operator: 'lteq', value: to },
  ];
  const bankId = await pennylane.getSavedBankAccountId();
  if (bankId) filter.push({ field: 'bank_account_id', operator: 'eq', value: bankId });

  let all = [];
  let cursor;
  do {
    const b = await pennylane.getTransactions({ filter, limit: 100, cursor });
    all = all.concat(b.items);
    cursor = b.has_more ? b.next_cursor : null;
    if (cursor) await pennylane.sleep(pennylane.RATE_LIMIT_DELAY);
  } while (cursor);
  return all.filter((t) => Number(t.amount || t.currency_amount) < 0);
}

// { from, to } au format AAAA-MM-JJ. { cached: true } réutilise un résultat de
// moins de 5 min (le connecteur IA peut enchaîner plusieurs questions).
async function loadBankExpenses({ from, to }, { cached = false } = {}) {
  const key = `${from}|${to}`;
  const hit = cache.get(key);
  if (cached && hit && Date.now() - hit.at < CACHE_MS) return hit.data;

  const expenseTx = await fetchDebits(from, to);
  const [cardLabels, cardUsers, cardVehicles] = await Promise.all([
    pennylane.getCardLabels(),
    pennylane.getCardUsers(),
    pennylane.getCardVehicles(),
  ]);
  const vehById = Object.fromEntries(VEHICLE_CATEGORIES.map((v) => [v.id, v.label]));
  const vehIds = VEHICLE_CATEGORIES.map((v) => v.id);

  const data = expenseTx.map((t) => {
    const ci = pennylane.cardInfo(t);
    const cats = t.categories || [];
    const vehFromCat = cats.map((c) => vehById[c.id]).find(Boolean);
    const vehicle = vehFromCat
      || (ci.masked && cardVehicles[ci.masked] ? vehById[cardVehicles[ci.masked]] : null)
      || null;
    const natureCat = cats.find((c) => !vehIds.includes(c.id));
    return {
      id: t.id,
      amount: Math.abs(Number(t.amount || t.currency_amount || 0)),
      date: t.date,
      label: t.label,
      masked: ci.masked,
      last4: ci.last4,
      employee: ci.employee,
      cardLabel: ci.masked ? (cardLabels[ci.masked] || null) : null,
      userId: ci.masked ? (cardUsers[ci.masked] || null) : null,
      vehicle,
      nature: natureCat ? natureCat.label : null,
      categories: cats.map((c) => c.label),
    };
  });

  cache.set(key, { at: Date.now(), data });
  if (cache.size > 20) cache.delete(cache.keys().next().value);
  return data;
}

module.exports = { loadBankExpenses };
