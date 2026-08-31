/**
 * Modes de paiement d'une dépense et logique de remboursement.
 *
 * - carte           : carte pro (débit sur le compte pro Pennylane) — à rapprocher
 *                     avec une transaction bancaire. C'est le défaut historique.
 * - cheque          : réglé par chèque de la société (caisse générale) — justificatif,
 *                     PAS de remboursement, PAS de débit carte.
 * - virement        : réglé par virement / compte société (caisse générale) — idem.
 * - caisse          : espèces de la caisse de l'entreprise — justificatif comptable,
 *                     PAS de remboursement, PAS de débit carte.
 * - especes         : espèces payées par le collaborateur (argent perso) — génère
 *                     une demande de remboursement.
 * - note_frais      : avance / carte perso — génère une demande de remboursement.
 *
 * Seules les dépenses "carte" correspondent à un débit du compte pro : les autres
 * ne doivent jamais servir à justifier une transaction bancaire.
 */
const PAYMENT_METHODS = ['carte', 'cheque', 'virement', 'caisse', 'especes', 'note_frais'];

const PAYMENT_LABELS = {
  carte: 'Carte pro',
  cheque: 'Chèque',
  virement: 'Virement (société)',
  caisse: 'Espèces (caisse)',
  especes: 'Espèces (perso)',
  note_frais: 'Note de frais',
};

function normalizeMethod(m) {
  return PAYMENT_METHODS.includes(m) ? m : 'carte';
}

// Paiement par carte pro (ou dépense historique sans mode) -> débit compte pro.
function isCardPayment(method) {
  return !method || method === 'carte';
}

// Le collaborateur a avancé l'argent -> demande de remboursement.
function isReimbursable(method) {
  return method === 'especes' || method === 'note_frais';
}

module.exports = { PAYMENT_METHODS, PAYMENT_LABELS, normalizeMethod, isCardPayment, isReimbursable };
