// Formatage des montants — règle unique pour toute l'app.
// Format français : espace des milliers, virgule décimale, espace avant €.
export function eur(n, { decimals = 2 } = {}) {
  return Number(n || 0).toLocaleString('fr-FR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }) + ' €';
}

// Variante sans centimes (graphes, chips compactes).
export function eurInt(n) {
  return eur(n, { decimals: 0 });
}

// Date locale au format YYYY-MM-DD.
// PAS toISOString() : il convertit en UTC et décale d'un jour entre minuit
// et ~2h du matin (heure française) — mois/dates faux dans les stats et
// sur les scans de nuit.
export function localDate(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
