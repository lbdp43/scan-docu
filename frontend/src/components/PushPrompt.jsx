import React, { useEffect, useState } from 'react';
import { getPushState, enablePush, pushSupported, isIOS, isStandalone, pushPermission } from '../utils/push';
import { haptic } from '../utils/haptic';

// Pop-up unique (par appareil) proposant d'activer les notifications.
// - Android / PWA installée : bouton "Activer" -> demande native du téléphone.
// - iPhone dans Safari (app non installée) : explique qu'il faut d'abord
//   installer l'app sur l'écran d'accueil (les notifications iOS l'exigent).
// "Plus tard" mémorise le refus — on ne redemande pas ; l'activation reste
// possible à tout moment dans Profil → Notifications.
const SEEN_KEY = 'lbdp_push_prompt_v1';

export default function PushPrompt() {
  const [mode, setMode] = useState(null); // 'enable' | 'ios-install' | 'done'
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    const t = setTimeout(async () => {
      try {
        if (localStorage.getItem(SEEN_KEY)) return;
        if (pushPermission() === 'denied') return; // le téléphone a déjà dit non
        if (!pushSupported()) {
          if (isIOS() && !isStandalone() && alive) setMode('ios-install');
          return;
        }
        const st = await getPushState();
        if (alive && st.supported && st.configured && !st.subscribed) setMode('enable');
      } catch {
        /* silencieux — le pop-up est un confort, jamais un blocage */
      }
    }, 1500);
    return () => { alive = false; clearTimeout(t); };
  }, []);

  function dismiss() {
    try { localStorage.setItem(SEEN_KEY, '1'); } catch {}
    setMode(null);
  }

  async function activate() {
    setBusy(true);
    try {
      await enablePush(); // déclenche la demande native Android/iOS
      haptic('success');
      try { localStorage.setItem(SEEN_KEY, '1'); } catch {}
      setMode('done');
      setTimeout(() => setMode(null), 2200);
    } catch {
      dismiss(); // refus natif ou erreur : on n'insiste pas
    } finally {
      setBusy(false);
    }
  }

  if (!mode) return null;

  return (
    <div className="fixed left-3 right-3 bottom-[96px] z-40 max-w-lg mx-auto animate-fade-up">
      <div className="p-4 rounded-3xl bg-bg2 border border-card-border shadow-2xl">
        {mode === 'done' ? (
          <p className="text-green-light text-sm font-medium text-center">{'🔔'} Notifications activ{'é'}es {'✓'}</p>
        ) : (
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-2xl bg-green-mid/20 flex items-center justify-center text-xl shrink-0">{'🔔'}</div>
            <div className="flex-1 min-w-0">
              <p className="text-text text-sm font-semibold">Activer les notifications ?</p>
              {mode === 'enable' ? (
                <>
                  <p className="text-text-muted text-xs mt-0.5">
                    Rappels des paiements {'à'} justifier, suivi des remboursements, alertes.
                  </p>
                  <div className="flex gap-2 mt-3">
                    <button
                      onClick={activate}
                      disabled={busy}
                      className="flex-1 py-2 rounded-xl bg-green-mid text-white text-xs font-semibold transition-transform active:scale-[0.97] disabled:opacity-60"
                    >
                      {busy ? 'Activation…' : 'Activer'}
                    </button>
                    <button
                      onClick={dismiss}
                      className="px-4 py-2 rounded-xl bg-bg border border-card-border text-text-muted text-xs font-medium"
                    >
                      Plus tard
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-text-muted text-xs mt-0.5">
                    Sur iPhone, installe d'abord l'app : <span className="text-text">Partager {'→'} {'«'} Sur l'{'é'}cran d'accueil {'»'}</span>, puis active les notifications dans Profil.
                  </p>
                  <button
                    onClick={dismiss}
                    className="mt-3 w-full py-2 rounded-xl bg-bg border border-card-border text-text-muted text-xs font-medium"
                  >
                    Compris
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
