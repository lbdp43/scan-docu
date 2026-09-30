/**
 * Serveur MCP en lecture seule (Claude, ChatGPT…) — POST /mcp/<clé secrète>.
 *
 * Transport « Streamable HTTP » en mode sans état : chaque requête POST porte
 * un message JSON-RPC (ou un lot) et reçoit sa réponse en application/json.
 * Aucun outil n'écrit quoi que ce soit.
 *
 * MONTANTS : l'app enregistre le montant payé figurant sur le ticket, donc du
 * TTC. La TVA n'est pas saisie : le HT n'est PAS disponible. Toutes les
 * réponses le rappellent pour qu'une IA n'invente pas de HT.
 */
const express = require('express');
const { getSecret, sameSecret } = require('../services/mcpSecret');
const { fiscalYear } = require('../services/fiscalYear');
const { PAYMENT_LABELS } = require('../services/payment');
const missing = require('../services/missing');
const pennylane = require('../services/pennylane');
const { loadBankExpenses } = require('../services/bankExpenses');
const { VEHICLE_CATEGORIES } = require('../services/categorize');

const router = express.Router();

const SERVER_INFO = { name: 'lbdp-notes-de-frais', version: '1.0.0' };
const PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];

const NOTE_MONTANTS = 'Tous les montants sont TTC (toutes taxes comprises) : c\'est le montant payé figurant sur le ticket. '
  + 'La TVA n\'est pas saisie dans l\'application, le montant HT n\'est donc pas disponible — ne pas le calculer ni l\'estimer.';

const INSTRUCTIONS = `Serveur en lecture seule des notes de frais de La Brasserie des Plantes (LBDP).
${NOTE_MONTANTS}
Commencer par « contexte » pour les conventions (exercice fiscal, modes de paiement, catégories, cartes, véhicules).
Deux sources : les tickets saisis dans l'app (resume_depenses, lister_depenses, evolution_mensuelle : par personne qui a saisi le ticket, par catégorie, par mode de paiement)
et le relevé bancaire du compte pro (depenses_compte_pro : par carte, par véhicule, par titulaire de carte, par catégorie comptable Pennylane).
Dates au format AAAA-MM-JJ. Sans dates, la période par défaut est le mois en cours.
Toujours préciser « TTC » en citant un montant.`;

const MODES = ['carte', 'note_frais', 'caisse', 'virement', 'cheque', 'especes'];

// ── Outils ─────────────────────────────────────────────────────────────
const periodProps = {
  date_debut: { type: 'string', description: 'Début de période inclus, AAAA-MM-JJ. Défaut : 1er du mois en cours.' },
  date_fin: { type: 'string', description: 'Fin de période incluse, AAAA-MM-JJ. Défaut : aujourd\'hui (ou fin du mois si date_debut est donnée).' },
};
const filterProps = {
  collaborateur: { type: 'string', description: 'Nom (ou partie du nom) du collaborateur, ou son identifiant.' },
  categorie: { type: 'string', description: 'Catégorie (ex. « Carburant », « Repas »), par libellé ou code.' },
  mode_paiement: { type: 'string', enum: MODES, description: 'carte = carte pro, note_frais = avancé par le collaborateur (à rembourser), caisse = espèces de la caisse, virement / cheque = payé par la société.' },
};
const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

const TOOLS = [
  {
    name: 'contexte',
    title: 'Conventions des notes de frais',
    description: 'Explique les conventions : montants TTC (pas de HT), exercice fiscal, modes de paiement, catégories et collaborateurs existants. À appeler en premier.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: READ_ONLY,
  },
  {
    name: 'resume_depenses',
    title: 'Total des dépenses et répartition',
    description: 'Combien a-t-on dépensé sur une période d\'après les tickets saisis dans l\'app : total TTC, nombre de tickets, et répartition par catégorie, par mode de paiement et par collaborateur (personne qui a saisi le ticket). Filtres optionnels. Pour une répartition par carte ou par véhicule, utiliser depenses_compte_pro.',
    inputSchema: { type: 'object', properties: { ...periodProps, ...filterProps }, additionalProperties: false },
    annotations: READ_ONLY,
  },
  {
    name: 'lister_depenses',
    title: 'Liste détaillée des dépenses',
    description: 'Liste les tickets (date, montant TTC, catégorie, commerçant, collaborateur, mode de paiement, justificatif) sur une période, du plus récent au plus ancien.',
    inputSchema: {
      type: 'object',
      properties: {
        ...periodProps,
        ...filterProps,
        limite: { type: 'integer', minimum: 1, maximum: 200, description: 'Nombre maximum de lignes (défaut 50, max 200).' },
      },
      additionalProperties: false,
    },
    annotations: READ_ONLY,
  },
  {
    name: 'evolution_mensuelle',
    title: 'Évolution mois par mois',
    description: 'Total TTC et nombre de tickets mois par mois sur une période (défaut : exercice fiscal en cours), avec le détail par catégorie de chaque mois.',
    inputSchema: { type: 'object', properties: { ...periodProps, ...filterProps }, additionalProperties: false },
    annotations: READ_ONLY,
  },
  {
    name: 'paiements_non_justifies',
    title: 'Paiements carte sans justificatif',
    description: 'Paiements de la carte pro (relevé bancaire Pennylane) pour lesquels aucun ticket n\'a été fourni, sur l\'exercice en cours. Filtre optionnel par collaborateur.',
    inputSchema: { type: 'object', properties: { collaborateur: filterProps.collaborateur }, additionalProperties: false },
    annotations: READ_ONLY,
  },
  {
    name: 'depenses_compte_pro',
    title: 'Dépenses du compte pro par carte et véhicule',
    description: 'Paiements réellement débités sur le compte pro (relevé bancaire Pennylane) : total TTC et répartition par carte, par véhicule, par titulaire de carte et par catégorie comptable, avec le nombre de paiements sans justificatif. '
      + 'Par défaut : paiements par carte du mois en cours. Filtres optionnels, et liste détaillée avec « limite ».',
    inputSchema: {
      type: 'object',
      properties: {
        ...periodProps,
        carte: { type: 'string', description: 'Carte : intitulé (ex. « Kangoo ») ou 4 derniers chiffres.' },
        vehicule: { type: 'string', description: `Véhicule : ${VEHICLE_CATEGORIES.map((v) => v.label).join(', ')}.` },
        titulaire: { type: 'string', description: 'Collaborateur à qui la carte est attribuée (nom ou partie du nom).' },
        categorie: { type: 'string', description: 'Catégorie comptable Pennylane (ex. « Carburant », « Péages et Parking »).' },
        inclure_hors_carte: { type: 'boolean', description: 'Inclure aussi les débits sans carte (prélèvements, virements, frais bancaires). Défaut : non.' },
        limite: { type: 'integer', minimum: 0, maximum: 200, description: 'Nombre de paiements à lister en détail (défaut 20, 0 = aucun).' },
      },
      additionalProperties: false,
    },
    annotations: READ_ONLY,
  },
];

// ── Utilitaires ────────────────────────────────────────────────────────
class ToolError extends Error {}

const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

function parsePeriod(args, { defaultFiscal = false } = {}) {
  for (const k of ['date_debut', 'date_fin']) {
    const v = args[k];
    if (v != null && (!ISO.test(v) || ymd(new Date(v)) !== v)) {
      throw new ToolError(`${k} doit être une date valide au format AAAA-MM-JJ (reçu : ${v}).`);
    }
  }
  const now = new Date();
  let from = args.date_debut;
  let to = args.date_fin;
  if (!from && !to) {
    if (defaultFiscal) {
      const fy = fiscalYear();
      from = fy.from;
      to = ymd(now);
    } else {
      from = `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-01`;
      to = ymd(now);
    }
  } else if (from && !to) {
    to = ymd(now);
  } else if (!from && to) {
    from = `${to.slice(0, 7)}-01`;
  }
  if (from > to) throw new ToolError('date_debut est après date_fin.');
  return { from, to };
}

async function loadRefs(prisma) {
  const [types, users] = await Promise.all([
    prisma.expenseType.findMany({ select: { value: true, label: true } }),
    prisma.user.findMany({ select: { id: true, name: true, is_active: true } }),
  ]);
  const typeLabel = Object.fromEntries(types.map((t) => [t.value, t.label]));
  const userName = Object.fromEntries(users.map((u) => [u.id, u.name]));
  return { types, users, typeLabel, userName };
}

function resolveUser(query, users) {
  if (query == null || query === '') return null;
  const asId = Number(query);
  if (Number.isInteger(asId) && users.some((u) => u.id === asId)) return [asId];
  const q = norm(query);
  const found = users.filter((u) => norm(u.name).includes(q));
  if (!found.length) {
    throw new ToolError(`Aucun collaborateur ne correspond à « ${query} ». Collaborateurs : ${users.map((u) => u.name).join(', ')}.`);
  }
  return found.map((u) => u.id);
}

function resolveType(query, types) {
  if (query == null || query === '') return null;
  const q = norm(query);
  const found = types.filter((t) => norm(t.value) === q || norm(t.label) === q)
    .concat(types.filter((t) => norm(t.label).includes(q) || norm(t.value).includes(q)));
  if (!found.length) {
    throw new ToolError(`Catégorie « ${query} » inconnue. Catégories : ${types.map((t) => t.label).join(', ')}.`);
  }
  return [...new Set(found.map((t) => t.value))];
}

async function fetchExpenses(prisma, args, refs, { defaultFiscal = false } = {}) {
  const period = parsePeriod(args, { defaultFiscal });
  if (args.mode_paiement && !MODES.includes(args.mode_paiement)) {
    throw new ToolError(`mode_paiement invalide. Valeurs : ${MODES.join(', ')}.`);
  }
  const userIds = resolveUser(args.collaborateur, refs.users);
  const typeValues = resolveType(args.categorie, refs.types);
  const where = { date_ticket: { gte: new Date(period.from), lte: new Date(period.to) } };
  if (userIds) where.user_id = { in: userIds };
  if (typeValues) where.type = { in: typeValues };
  if (args.mode_paiement) where.payment_method = args.mode_paiement;
  const rows = await prisma.expense.findMany({
    where,
    select: {
      id: true, date_ticket: true, amount: true, type: true, merchant: true, description: true,
      user_id: true, payment_method: true, has_receipt: true, reimbursement_status: true,
    },
    orderBy: { date_ticket: 'desc' },
  });
  const filtres = {};
  if (userIds) filtres.collaborateur = userIds.map((id) => refs.userName[id]).join(', ');
  if (typeValues) filtres.categorie = typeValues.map((v) => refs.typeLabel[v] || v).join(', ');
  if (args.mode_paiement) filtres.mode_paiement = PAYMENT_LABELS[args.mode_paiement] || args.mode_paiement;
  return { period, rows, filtres };
}

async function cardsSummary(refs) {
  try {
    const [labels, users, vehicles] = await Promise.all([
      pennylane.getCardLabels(), pennylane.getCardUsers(), pennylane.getCardVehicles(),
    ]);
    const vehById = Object.fromEntries(VEHICLE_CATEGORIES.map((v) => [v.id, v.label]));
    const snap = await missing.readSnapshot().catch(() => null);
    const masked = new Set([...Object.keys(labels), ...Object.keys(users), ...Object.keys(vehicles),
      ...((snap?.cards || []).map((c) => c.masked).filter(Boolean))]);
    return [...masked].map((m) => ({
      carte: `•••• ${m.slice(-4)}`,
      intitule: labels[m] || null,
      vehicule: vehicles[m] ? (vehById[vehicles[m]] || null) : null,
      titulaire: users[m] ? (refs.userName[users[m]] || null) : null,
    }));
  } catch {
    return [];
  }
}

function groupBy(rows, keyFn, labelFn, total) {
  const map = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    const g = map.get(k) || { total: 0, n: 0 };
    g.total += Number(r.amount);
    g.n += 1;
    map.set(k, g);
  }
  return [...map.entries()]
    .sort((a, b) => b[1].total - a[1].total)
    .map(([k, g]) => ({
      nom: labelFn(k),
      total_ttc: r2(g.total),
      nombre: g.n,
      part_pourcent: total > 0 ? Math.round((g.total / total) * 1000) / 10 : 0,
    }));
}

const methodLabel = (m) => PAYMENT_LABELS[m || 'carte'] || m;

// ── Implémentation des outils ──────────────────────────────────────────
const HANDLERS = {
  async contexte(prisma) {
    const refs = await loadRefs(prisma);
    const fy = fiscalYear();
    return {
      montants: NOTE_MONTANTS,
      devise: 'EUR',
      exercice_fiscal: { regle: 'Du 1er juillet au 30 juin', en_cours: { debut: fy.from, fin: fy.to, libelle: fy.label } },
      modes_de_paiement: {
        carte: 'Carte pro de la société (débit sur le compte pro, rapproché avec le relevé bancaire)',
        note_frais: 'Avancé par le collaborateur avec son argent : à lui rembourser',
        caisse: 'Espèces de la caisse de l\'entreprise',
        virement: 'Payé par virement de la société',
        cheque: 'Payé par chèque de la société',
        especes: 'Ancien mode « espèces perso », équivalent note de frais (à rembourser)',
      },
      categories: refs.types.map((t) => ({ code: t.value, libelle: t.label })),
      collaborateurs: refs.users.map((u) => ({ id: u.id, nom: u.name, actif: u.is_active })),
      vehicules: VEHICLE_CATEGORIES.map((v) => v.label),
      cartes: await cardsSummary(refs),
      sources: {
        tickets: 'Tickets saisis dans l\'app (resume_depenses, lister_depenses, evolution_mensuelle) : « collaborateur » = personne qui a saisi le ticket.',
        compte_pro: 'Relevé bancaire Pennylane (depenses_compte_pro) : par carte, véhicule, titulaire de carte, catégorie comptable.',
      },
      periode_par_defaut: 'Mois en cours (sauf evolution_mensuelle : exercice fiscal en cours)',
    };
  },

  async resume_depenses(prisma, args) {
    const refs = await loadRefs(prisma);
    const { period, rows, filtres } = await fetchExpenses(prisma, args, refs);
    const total = rows.reduce((s, r) => s + Number(r.amount), 0);
    const aRembourser = rows.filter((r) => r.reimbursement_status === 'pending');
    return {
      periode: { debut: period.from, fin: period.to },
      filtres,
      total_ttc: r2(total),
      nombre_tickets: rows.length,
      ticket_moyen_ttc: rows.length ? r2(total / rows.length) : 0,
      par_categorie: groupBy(rows, (r) => r.type, (k) => refs.typeLabel[k] || k, total),
      par_mode_paiement: groupBy(rows, (r) => r.payment_method || 'carte', methodLabel, total),
      par_collaborateur: groupBy(rows, (r) => r.user_id, (k) => refs.userName[k] || `#${k}`, total),
      sans_photo: rows.filter((r) => !r.has_receipt).length,
      notes_de_frais_a_rembourser: { nombre: aRembourser.length, total_ttc: r2(aRembourser.reduce((s, r) => s + Number(r.amount), 0)) },
      montants: NOTE_MONTANTS,
    };
  },

  async lister_depenses(prisma, args) {
    const refs = await loadRefs(prisma);
    const { period, rows, filtres } = await fetchExpenses(prisma, args, refs);
    const limite = Math.min(Math.max(parseInt(args.limite, 10) || 50, 1), 200);
    return {
      periode: { debut: period.from, fin: period.to },
      filtres,
      nombre_total: rows.length,
      total_ttc: r2(rows.reduce((s, r) => s + Number(r.amount), 0)),
      affiches: Math.min(limite, rows.length),
      depenses: rows.slice(0, limite).map((r) => ({
        date: ymd(new Date(r.date_ticket)),
        montant_ttc: r2(r.amount),
        categorie: refs.typeLabel[r.type] || r.type,
        commercant: r.merchant || null,
        description: r.description || null,
        collaborateur: refs.userName[r.user_id] || null,
        mode_paiement: methodLabel(r.payment_method),
        justificatif_photo: !!r.has_receipt,
        remboursement: r.reimbursement_status || null,
      })),
      montants: NOTE_MONTANTS,
    };
  },

  async evolution_mensuelle(prisma, args) {
    const refs = await loadRefs(prisma);
    const { period, rows, filtres } = await fetchExpenses(prisma, args, refs, { defaultFiscal: true });
    const months = new Map();
    // Tous les mois de la période, même vides
    for (let [y, m] = period.from.split('-').map(Number); `${y}-${pad(m)}` <= period.to.slice(0, 7);) {
      months.set(`${y}-${pad(m)}`, { total: 0, n: 0, cats: {} });
      m += 1; if (m > 12) { m = 1; y += 1; }
    }
    for (const r of rows) {
      const k = ymd(new Date(r.date_ticket)).slice(0, 7);
      const g = months.get(k);
      if (!g) continue;
      g.total += Number(r.amount);
      g.n += 1;
      const c = refs.typeLabel[r.type] || r.type;
      g.cats[c] = (g.cats[c] || 0) + Number(r.amount);
    }
    const total = rows.reduce((s, r) => s + Number(r.amount), 0);
    return {
      periode: { debut: period.from, fin: period.to },
      filtres,
      total_ttc: r2(total),
      mois: [...months.entries()].map(([mois, g]) => ({
        mois,
        total_ttc: r2(g.total),
        nombre_tickets: g.n,
        par_categorie_ttc: Object.fromEntries(Object.entries(g.cats).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, r2(v)])),
      })),
      montants: NOTE_MONTANTS,
    };
  },

  async paiements_non_justifies(prisma, args) {
    const refs = await loadRefs(prisma);
    const userIds = resolveUser(args.collaborateur, refs.users);
    const snap = await missing.readSnapshot(); // lecture du cache : aucun appel Pennylane
    if (!snap || !snap.connection?.ok) {
      return { disponible: false, raison: 'Données bancaires Pennylane pas encore calculées ou connexion Pennylane indisponible.' };
    }
    const cardUser = {};
    for (const c of snap.cards || []) if (c.masked) cardUser[c.masked] = c.userId || null;
    let tx = (snap.transactions || []).map((t) => {
      const uid = t.card?.masked ? cardUser[t.card.masked] : null;
      return {
        date: String(t.date || '').slice(0, 10),
        montant_ttc: r2(t.amount),
        libelle_bancaire: t.label || null,
        carte: t.card?.label || (t.card?.last4 ? `•••• ${t.card.last4}` : null),
        collaborateur: uid ? (refs.userName[uid] || null) : 'Carte non attribuée',
        _uid: uid,
      };
    });
    if (userIds) tx = tx.filter((t) => userIds.includes(t._uid));
    tx.sort((a, b) => (a.date < b.date ? 1 : -1));
    const total = tx.reduce((s, t) => s + t.montant_ttc, 0);
    const parCollab = {};
    for (const t of tx) {
      const k = t.collaborateur || 'Inconnu';
      parCollab[k] = parCollab[k] || { nombre: 0, total_ttc: 0 };
      parCollab[k].nombre += 1;
      parCollab[k].total_ttc = r2(parCollab[k].total_ttc + t.montant_ttc);
    }
    return {
      exercice: snap.fiscalYear ? { debut: snap.fiscalYear.from, fin: snap.fiscalYear.to } : null,
      calcule_le: snap.computedAt,
      nombre: tx.length,
      total_ttc: r2(total),
      par_collaborateur: parCollab,
      paiements: tx.slice(0, 200).map(({ _uid, ...t }) => t),
      montants: 'Montants TTC débités sur le compte bancaire (carte pro). Le HT n\'est pas disponible.',
    };
  },

  async depenses_compte_pro(prisma, args) {
    const period = parsePeriod(args);
    if (!(await pennylane.getToken())) {
      return { disponible: false, raison: 'Pennylane n\'est pas connecté : le relevé bancaire n\'est pas accessible.' };
    }
    const refs = await loadRefs(prisma);
    let all;
    try {
      all = await loadBankExpenses(period, { cached: true });
    } catch (e) {
      throw new ToolError(`Relevé bancaire Pennylane indisponible pour le moment (${e.message}).`);
    }
    const snap = await missing.readSnapshot().catch(() => null);
    const covered = snap?.connection?.ok && snap.fiscalYear ? snap.fiscalYear : null;
    const unjustified = new Set((snap?.transactions || []).map((t) => String(t.transactionId)));

    const cardName = (t) => (t.masked ? (t.cardLabel ? `${t.cardLabel} (•••• ${t.last4})` : `•••• ${t.last4}`) : 'Hors carte (prélèvement, virement…)');
    const holder = (t) => {
      if (!t.masked) return 'Hors carte';
      if (t.userId && refs.userName[t.userId]) return refs.userName[t.userId];
      return t.employee ? `${t.employee} (titulaire Pennylane)` : 'Carte non attribuée';
    };
    let rows = all.map((t) => {
      const day = String(t.date || '').slice(0, 10);
      const inCover = covered && day >= covered.from && day <= covered.to;
      return {
        ...t,
        day,
        _carte: cardName(t),
        _titulaire: holder(t),
        _justifie: inCover ? !unjustified.has(String(t.id)) : null,
      };
    });

    const filtres = {};
    if (!args.inclure_hors_carte) rows = rows.filter((t) => t.masked);
    else filtres.hors_carte = 'inclus';
    if (args.carte) {
      const q = norm(args.carte);
      const before = rows;
      rows = rows.filter((t) => t.masked && (t.last4 === String(args.carte).trim() || norm(t.cardLabel).includes(q)));
      if (!rows.length && before.length) {
        const cards = [...new Set(before.filter((t) => t.masked).map((t) => t._carte))];
        throw new ToolError(`Aucune carte ne correspond à « ${args.carte} ». Cartes sur la période : ${cards.join(', ') || 'aucune'}.`);
      }
      filtres.carte = args.carte;
    }
    if (args.vehicule) {
      const q = norm(args.vehicule);
      rows = rows.filter((t) => t.vehicle && norm(t.vehicle).includes(q));
      filtres.vehicule = args.vehicule;
    }
    if (args.titulaire) {
      const ids = resolveUser(args.titulaire, refs.users);
      const q = norm(args.titulaire);
      rows = rows.filter((t) => (t.userId && ids.includes(t.userId)) || (!t.userId && norm(t.employee).includes(q)));
      filtres.titulaire = ids.map((id) => refs.userName[id]).join(', ');
    }
    if (args.categorie) {
      const q = norm(args.categorie);
      rows = rows.filter((t) => t.categories.some((c) => norm(c).includes(q)));
      filtres.categorie = args.categorie;
    }

    const total = rows.reduce((s, t) => s + t.amount, 0);
    const checked = rows.filter((t) => t._justifie !== null);
    const missingRows = checked.filter((t) => !t._justifie);
    const limite = args.limite === undefined ? 20 : Math.min(Math.max(parseInt(args.limite, 10) || 0, 0), 200);
    const sorted = [...rows].sort((a, b) => (a.day < b.day ? 1 : -1));

    return {
      source: 'Relevé bancaire du compte pro (Pennylane) : paiements réellement débités.',
      periode: { debut: period.from, fin: period.to },
      filtres,
      total_ttc: r2(total),
      nombre_paiements: rows.length,
      par_carte: groupBy(rows, (t) => t._carte, (k) => k, total),
      par_vehicule: groupBy(rows, (t) => t.vehicle || 'Véhicule non renseigné', (k) => k, total),
      par_titulaire: groupBy(rows, (t) => t._titulaire, (k) => k, total),
      par_categorie: groupBy(rows, (t) => t.nature || 'Non catégorisé', (k) => k, total),
      justificatifs: covered
        ? {
          verifies: checked.length,
          sans_justificatif: missingRows.length,
          montant_sans_justificatif_ttc: r2(missingRows.reduce((s, t) => s + t.amount, 0)),
          note: checked.length < rows.length ? `Statut connu seulement pour l'exercice ${covered.from} → ${covered.to}.` : undefined,
        }
        : { note: 'Statut des justificatifs pas encore calculé.' },
      affiches: Math.min(limite, rows.length),
      paiements: sorted.slice(0, limite).map((t) => ({
        date: t.day,
        montant_ttc: r2(t.amount),
        libelle_bancaire: t.label || null,
        carte: t._carte,
        vehicule: t.vehicle,
        titulaire: t._titulaire,
        categories: t.categories,
        justifie: t._justifie,
      })),
      a_savoir: 'Le titulaire est le collaborateur à qui la carte est attribuée dans l\'app. Les cartes restent dans les véhicules et peuvent être utilisées par n\'importe qui : '
        + 'pour savoir qui a réellement fait une dépense, voir les tickets saisis (resume_depenses, par collaborateur).',
      montants: 'Montants TTC débités sur le compte bancaire. Le HT n\'est pas disponible — ne pas le calculer ni l\'estimer.',
    };
  },
};

// ── JSON-RPC ───────────────────────────────────────────────────────────
function rpcResult(id, result) { return { jsonrpc: '2.0', id, result }; }
function rpcError(id, code, message) { return { jsonrpc: '2.0', id, error: { code, message } }; }

async function handleMessage(prisma, msg) {
  if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
    return rpcError(msg?.id ?? null, -32600, 'Requête JSON-RPC invalide');
  }
  const isNotification = msg.id === undefined || msg.id === null;
  if (isNotification) return null; // notifications/initialized, etc. : pas de réponse

  const { id, method, params = {} } = msg;
  switch (method) {
    case 'initialize': {
      const asked = params.protocolVersion;
      return rpcResult(id, {
        protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      });
    }
    case 'ping':
      return rpcResult(id, {});
    case 'tools/list':
      return rpcResult(id, { tools: TOOLS });
    case 'tools/call': {
      const handler = HANDLERS[params.name];
      if (!handler) return rpcError(id, -32602, `Outil inconnu : ${params.name}`);
      try {
        const data = await handler(prisma, params.arguments || {});
        return rpcResult(id, {
          content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
          structuredContent: data,
        });
      } catch (e) {
        if (!(e instanceof ToolError)) console.error('[mcp] tool error:', params.name, e.message);
        return rpcResult(id, {
          content: [{ type: 'text', text: e instanceof ToolError ? e.message : 'Erreur interne lors de la lecture des données.' }],
          isError: true,
        });
      }
    }
    default:
      return rpcError(id, -32601, `Méthode non supportée : ${method}`);
  }
}

// Authentification par la clé dans l'URL
router.use('/:secret', async (req, res, next) => {
  try {
    const expected = await getSecret(req.prisma);
    if (!sameSecret(req.params.secret, expected)) return res.status(404).json({ error: 'Not found' });
    next();
  } catch (e) {
    console.error('[mcp] auth error:', e.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.post('/:secret', async (req, res) => {
  const body = req.body;
  if (body == null || (typeof body !== 'object')) {
    return res.status(400).json(rpcError(null, -32700, 'JSON invalide'));
  }
  const batch = Array.isArray(body);
  const messages = batch ? body : [body];
  const replies = (await Promise.all(messages.map((m) => handleMessage(req.prisma, m)))).filter(Boolean);
  if (!replies.length) return res.status(202).end();
  res.json(batch ? replies : replies[0]);
});

// Pas de flux SSE ni de session côté serveur
router.all('/:secret', (req, res) => {
  res.set('Allow', 'POST').status(405).json({ error: 'Method not allowed' });
});

module.exports = router;
module.exports._test = { handleMessage, TOOLS, HANDLERS };
