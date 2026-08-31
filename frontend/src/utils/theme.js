// Thème clair/sombre — interrupteur manuel (Profil), mémorisé par appareil.
// Sombre par défaut. Appliqué très tôt via le script inline d'index.html
// pour éviter un flash au chargement.
const KEY = 'lbdp_theme';
const META_COLORS = { dark: '#0C150D', light: '#F3F6F2' };

export function getTheme() {
  try {
    return localStorage.getItem(KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

export function applyTheme(theme) {
  const t = theme === 'light' ? 'light' : 'dark';
  if (t === 'light') document.documentElement.setAttribute('data-theme', 'light');
  else document.documentElement.removeAttribute('data-theme');
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', META_COLORS[t]);
}

export function setTheme(theme) {
  const t = theme === 'light' ? 'light' : 'dark';
  try { localStorage.setItem(KEY, t); } catch {}
  applyTheme(t);
  return t;
}
