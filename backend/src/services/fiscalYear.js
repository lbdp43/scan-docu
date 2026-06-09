/**
 * Exercice fiscal de La Brasserie des Plantes : clôture au 30 juin.
 * L'exercice va du 1er juillet (année N) au 30 juin (année N+1).
 *
 * Remplace l'ancien filtrage sur l'année civile (1er janv -> 31 déc), qui était
 * faux autour de la bascule de juin/juillet.
 */
function fiscalYear(ref) {
  const d = ref ? new Date(ref) : new Date();
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1; // 1..12
  const startYear = m >= 7 ? y : y - 1; // juillet ou après -> exercice ouvert cette année
  return {
    from: `${startYear}-07-01`,
    to: `${startYear + 1}-06-30`,
    startYear,
    endYear: startYear + 1,
    label: `${startYear}-${startYear + 1}`,
  };
}

module.exports = { fiscalYear };
