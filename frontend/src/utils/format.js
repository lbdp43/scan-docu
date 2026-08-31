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
