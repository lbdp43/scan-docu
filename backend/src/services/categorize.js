/**
 * Catégorisation analytique automatique des transactions carte.
 *
 * 1) NATURE (depuis le ticket scan-docu correspondant) : carburant -> Carburant,
 *    repas -> Restauration et Repas, péage -> Péages et Parking. Posée uniquement
 *    sur les transactions SANS aucune catégorie ('autre'/perso : ignoré).
 * 2) VÉHICULE (depuis la carte) : Berlingot / Ford / Kangoo… selon l'attribution
 *    carte->véhicule (admin). Ajoutée tant que la transaction n'a pas déjà une
 *    catégorie du groupe "véhicule".
 *
 * Non destructif : on PRÉSERVE les catégories existantes (le PUT remplace toute la
 * liste, donc on renvoie existant + ajout). Idempotent. Réversible (PUT []).
 */
const pennylane = require('./pennylane');
const match = require('./match');
const { fiscalYear } = require('./fiscalYear');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// type de dépense scan-docu -> id catégorie "nature" Pennylane (LBDP)
const TYPE_TO_CATEGORY = {
  carburant: 190533513216, // Carburant
  repas: 190538297344,     // Restauration et Repas
  peage: 190534152192,     // Péages et Parking
};

// Groupe "véhicule" Pennylane + options proposées dans l'admin
const VEHICLE_GROUP_ID = 12745461760;
const VEHICLE_CATEGORIES = [
  { id: 190536069120, label: 'Berlingot' },
  { id: 190536073216, label: 'Berlingot Neuf' },
  { id: 190535614464, label: 'Ford' },
  { id: 190535610368, label: 'Kangoo' },
];
const VEHICLE_IDS = VEHICLE_CATEGORIES.map((v) => v.id);

// Plafond d'écritures par exécution (évite les timeouts au 1er gros passage ;
// le reste est traité au run horaire suivant, de façon idempotente).
const MAX_PER_RUN = 150;

async function categorizeByType(db) {
  const token = await pennylane.getToken();
  if (!token) return { skipped: 'Pennylane non configuré' };

  const { from, to } = fiscalYear();
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
  const cardTx = all.filter((t) => Number(t.amount || t.currency_amount) < 0);

  const expRows = await (db || prisma).expense.findMany({
    where: { date_ticket: { gte: new Date(from) } },
    omit: { receipt_image: true },
  });
  const expenses = expRows.map((e) => ({
    amount: Number(e.amount),
    dateMs: match.dms(e.date_ticket),
    type: e.type,
  }));

  const cardVehicles = await pennylane.getCardVehicles(); // { masked: categoryId }

  let natureSet = 0;
  let vehicleSet = 0;
  let errors = 0;
  let writes = 0;
  let capped = false;

  for (const tx of cardTx) {
    if (writes >= MAX_PER_RUN) { capped = true; break; }

    const ci = pennylane.cardInfo(tx);
    const existing = tx.categories || [];
    const final = existing.map((c) => ({ id: c.id, weight: String(c.weight || '1.0') }));
    let addNature = false;
    let addVehicle = false;

    // 2) Véhicule (depuis la carte) — seulement si pas déjà une catégorie du groupe véhicule
    const vehId = ci.masked ? cardVehicles[ci.masked] : null;
    const hasVehicle = existing.some(
      (c) => VEHICLE_IDS.includes(c.id) || (c.category_group && c.category_group.id === VEHICLE_GROUP_ID)
    );
    if (vehId && !hasVehicle) {
      final.push({ id: vehId, weight: '1.0' });
      addVehicle = true;
    }

    // 1) Nature (depuis le ticket) — seulement si la transaction n'a AUCUNE catégorie
    if (existing.length === 0) {
      const a = Math.abs(Number(tx.amount || tx.currency_amount || 0));
      const tdms = match.dms(tx.date);
      let type = null;
      let best = 0;
      for (const e of expenses) {
        const s = match.expenseScore(e.amount, e.dateMs, a, tdms);
        if (s > best) { best = s; type = e.type; }
      }
      const catId = best >= 25 ? TYPE_TO_CATEGORY[type] : null;
      if (catId && !final.some((c) => c.id === catId)) {
        final.push({ id: catId, weight: '1.0' });
        addNature = true;
      }
    }

    if (!addNature && !addVehicle) continue;
    try {
      await pennylane.setTransactionCategories(tx.id, final);
      if (addVehicle) vehicleSet++;
      if (addNature) natureSet++;
      writes++;
      await pennylane.sleep(pennylane.RATE_LIMIT_DELAY);
    } catch (e) {
      errors++;
    }
  }

  return { considered: cardTx.length, natureSet, vehicleSet, errors, capped };
}

module.exports = { categorizeByType, TYPE_TO_CATEGORY, VEHICLE_GROUP_ID, VEHICLE_CATEGORIES, VEHICLE_IDS };
