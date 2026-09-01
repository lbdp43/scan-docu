import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import Toast from '../components/Toast';

// Page « Raccourcis » : installer un bouton Scanner sur l'écran d'accueil,
// et fabriquer un widget pleine largeur via une app de widgets (KWGT / Raccourcis iOS).
export default function Shortcuts() {
  const [toast, setToast] = useState(null);
  const scanUrl = `${window.location.origin}/?src=widget`;

  async function copyUrl() {
    try {
      await navigator.clipboard.writeText(scanUrl);
      setToast({ message: 'Lien copié ✓', type: 'success' });
    } catch {
      setToast({ message: scanUrl, type: 'info' });
    }
  }

  return (
    <div className="space-y-6">
      {toast && <Toast {...toast} onClose={() => setToast(null)} />}

      <div className="flex items-center gap-3">
        <Link to="/profile" className="text-text-muted hover:text-text transition-colors">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
        </Link>
        <h1 className="font-serif text-xl font-semibold">Raccourcis & widget</h1>
      </div>

      {/* 1. Bouton icône sur l'écran d'accueil */}
      <div className="p-5 rounded-3xl bg-card border border-card-border space-y-3">
        <div className="flex items-center gap-3">
          <img src="/shortcut-scan.png" alt="Raccourci Scanner" className="w-12 h-12 rounded-xl bg-white shrink-0" />
          <div>
            <h2 className="text-text font-semibold text-sm">Bouton « Scanner » sur l'écran d'accueil</h2>
            <p className="text-text-muted text-xs">Un appui → la prise de photo s'ouvre.</p>
          </div>
        </div>
        <div className="space-y-2 text-xs text-text-muted">
          <p>
            <span className="text-text font-medium">Android :</span> appui <span className="text-text">long</span> sur
            l'icône de l'app LBDP → le menu affiche « <span className="text-text">Scanner</span> » → garde le doigt
            dessus et <span className="text-text">glisse-le sur l'écran d'accueil</span>. Il devient un bouton indépendant.
          </p>
          <p>
            <span className="text-text font-medium">iPhone :</span> app <span className="text-text">Raccourcis</span> → «&nbsp;+&nbsp;» →
            action « Ouvrir l'URL » → colle le lien ci-dessous → nomme-le « Prendre une photo » →
            « Ajouter à l'écran d'accueil » (tu peux mettre le logo en icône).
          </p>
        </div>
      </div>

      {/* 2. Widget pleine largeur */}
      <div className="p-5 rounded-3xl bg-card border border-card-border space-y-3">
        <h2 className="text-text font-semibold text-sm">Widget pleine largeur (hauteur réduite)</h2>
        <p className="text-text-muted text-xs">
          Les widgets de forme libre ne peuvent pas être fournis par une app web — mais tu peux le créer en
          2 minutes avec une app de widgets. La bannière est prête :
        </p>
        <img src="/widget-scanner.png" alt="Bannière du widget Scanner" className="w-full rounded-2xl border border-card-border" />
        <a
          href="/widget-scanner.png"
          download="widget-scanner-lbdp.png"
          className="block w-full text-center py-2.5 rounded-xl bg-green-mid/20 border border-green-mid/40 text-green-light text-xs font-medium"
        >
          ⬇ Télécharger la bannière
        </a>
        <div className="space-y-2 text-xs text-text-muted">
          <p>
            <span className="text-text font-medium">Android (KWGT, gratuit) :</span> installe KWGT → pose un widget
            KWGT de la taille voulue (ex. 4×1, pleine largeur) → touche-le → ajoute une couche
            <span className="text-text"> Image</span> avec la bannière téléchargée → action
            « <span className="text-text">Ouvrir un lien</span> » avec le lien ci-dessous.
          </p>
          <p>
            <span className="text-text font-medium">iPhone :</span> widget « Raccourcis » (petit ou moyen) pointant
            sur le raccourci créé ci-dessus.
          </p>
        </div>
        <button
          onClick={copyUrl}
          className="w-full py-2.5 rounded-xl bg-bg border border-card-border text-text text-xs font-mono break-all"
        >
          {scanUrl} <span className="text-green-light font-sans font-medium ml-1">Copier</span>
        </button>
      </div>

      <p className="text-text-dim text-[11px]">
        Dans tous les cas, le bouton ouvre la page Scanner — il reste un appui sur « Prendre une photo »
        (le téléphone interdit d'ouvrir la caméra sans geste de l'utilisateur).
      </p>
    </div>
  );
}
