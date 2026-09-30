import React, { useState } from 'react';
import { api } from '../utils/api';

// Carte admin : URL du connecteur MCP lecture seule (Claude / ChatGPT).
// L'URL contient la clé secrète : elle n'est chargée qu'à la demande.
export default function McpConnector({ onToast }) {
  const [info, setInfo] = useState(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  async function reveal() {
    setOpen(true);
    if (info) return;
    setBusy(true);
    try {
      setInfo(await api.getMcpInfo());
    } catch (err) {
      onToast?.({ message: err.message, type: 'error' });
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(info.url);
      onToast?.({ message: 'Adresse copiée', type: 'success' });
    } catch {
      onToast?.({ message: 'Copie impossible — sélectionne l\'adresse à la main', type: 'error' });
    }
  }

  async function regenerate() {
    if (!window.confirm('Générer une nouvelle adresse ? L\'ancienne cessera de fonctionner : il faudra la remplacer dans Claude et ChatGPT.')) return;
    setBusy(true);
    try {
      setInfo(await api.regenerateMcp());
      onToast?.({ message: 'Nouvelle adresse générée', type: 'success' });
    } catch (err) {
      onToast?.({ message: err.message, type: 'error' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="p-4 rounded-2xl bg-card border border-card-border space-y-3">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-blue-500/15 flex items-center justify-center shrink-0">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="text-blue-400">
            <path d="M9 17H7a5 5 0 010-10h2M15 7h2a5 5 0 010 10h-2M8 12h8" />
          </svg>
        </div>
        <div className="flex-1">
          <p className="text-text text-sm font-medium">Connecteur IA (Claude, ChatGPT)</p>
          <p className="text-text-muted text-xs">Lecture seule : totaux par catégorie, personne, carte, véhicule, évolution — montants TTC</p>
        </div>
      </div>

      {!open ? (
        <button
          onClick={reveal}
          className="w-full py-2.5 rounded-xl bg-bg border border-card-border text-text text-xs font-medium"
        >
          Afficher l'adresse du connecteur
        </button>
      ) : busy && !info ? (
        <div className="h-10 rounded-xl bg-bg animate-pulse" />
      ) : info ? (
        <>
          <div className="p-3 rounded-xl bg-bg border border-card-border">
            <p className="text-text text-[11px] font-mono break-all select-all">{info.url}</p>
          </div>
          <div className="flex gap-2">
            <button onClick={copy} className="flex-1 py-2.5 rounded-xl bg-green-mid text-white text-xs font-medium">
              Copier l'adresse
            </button>
            {!info.fromEnv && (
              <button
                onClick={regenerate}
                disabled={busy}
                className="px-4 py-2.5 rounded-xl bg-bg border border-card-border text-text-muted text-xs font-medium disabled:opacity-50"
              >
                Régénérer
              </button>
            )}
          </div>
          <p className="text-amber-400 text-[11px]">
            Cette adresse donne accès aux dépenses : ne la partage pas. En cas de doute, régénère-la.
          </p>
          <details className="text-xs text-text-muted">
            <summary className="cursor-pointer text-text">Comment l'ajouter</summary>
            <div className="mt-2 space-y-2">
              <p>
                <span className="text-text font-medium">Claude :</span> Paramètres → Connecteurs → Ajouter un
                connecteur personnalisé → colle l'adresse → Ajouter. Puis active-le dans une conversation.
              </p>
              <p>
                <span className="text-text font-medium">ChatGPT :</span> Paramètres → Applications et connecteurs →
                Paramètres avancés → active le mode développeur → Créer → colle l'adresse, authentification
                « Aucune » → Créer.
              </p>
              <p>Ensuite, demande par exemple : « Combien a-t-on dépensé en carburant ce mois-ci ? »</p>
            </div>
          </details>
        </>
      ) : null}
    </div>
  );
}
