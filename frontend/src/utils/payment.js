// Modes de paiement d'une dépense (doit rester aligné avec backend/src/services/payment.js)
// "note_frais" couvre l'argent avancé par le collaborateur (espèces perso ou carte perso).
export const PAYMENT_OPTIONS = [
  { value: 'carte', label: 'Carte pro' },
  { value: 'cheque', label: 'Chèque' },
  { value: 'virement', label: 'Virement (société)' },
  { value: 'caisse', label: 'Espèces (caisse)' },
  { value: 'note_frais', label: 'Note de frais' },
];

// Modes générant une demande de remboursement (argent avancé par le collaborateur).
// 'especes' conservé pour compatibilité avec d'anciennes dépenses.
export const REIMBURSABLE_METHODS = ['especes', 'note_frais'];

export const PAYMENT_LABELS = PAYMENT_OPTIONS.reduce((acc, o) => {
  acc[o.value] = o.label;
  return acc;
}, {});
