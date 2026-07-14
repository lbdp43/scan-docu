// Modes de paiement d'une dépense (doit rester aligné avec backend/src/services/payment.js)
export const PAYMENT_OPTIONS = [
  { value: 'carte', label: 'Carte pro' },
  { value: 'caisse', label: 'Espèces (caisse)' },
  { value: 'especes', label: 'Espèces (perso)' },
  { value: 'note_frais', label: 'Note de frais' },
];

// Modes générant une demande de remboursement (argent avancé par le collaborateur)
export const REIMBURSABLE_METHODS = ['especes', 'note_frais'];

export const PAYMENT_LABELS = PAYMENT_OPTIONS.reduce((acc, o) => {
  acc[o.value] = o.label;
  return acc;
}, {});
