import React, { useMemo, useState, useEffect, useCallback, useRef, useLayoutEffect } from 'react';
import { Outlet, NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getPendingExpenses, syncPendingExpenses, removePendingExpense, storableToFile } from '../utils/offline';
import { api } from '../utils/api';
import { haptic } from '../utils/haptic';

function NavIcon({ name, active }) {
  const color = active ? 'currentColor' : 'currentColor';
  const props = { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: color, strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' };
  switch (name) {
    case 'scan': return (<svg {...props}><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="12" cy="12" r="3.5" /><path d="M3 9h2M19 9h2M3 15h2M19 15h2" /></svg>);
    case 'home': return (<svg {...props}><path d="M3 10.5L12 3l9 7.5V20a1 1 0 01-1 1H4a1 1 0 01-1-1z" /><path d="M9 21V14h6v7" /></svg>);
    case 'history': return (<svg {...props}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 3" /></svg>);
    case 'stats': return (<svg {...props}><path d="M4 20h16" /><rect x="4" y="13" width="3" height="7" rx="1" fill={active ? color : 'none'} /><rect x="10.5" y="8" width="3" height="12" rx="1" fill={active ? color : 'none'} /><rect x="17" y="4" width="3" height="16" rx="1" fill={active ? color : 'none'} /></svg>);
    case 'admin': return (<svg {...props}><circle cx="12" cy="12" r="3" /><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" /></svg>);
    case 'profile': return (<svg {...props}><circle cx="12" cy="8" r="4" /><path d="M4 21v-1a6 6 0 0112 0v1" /></svg>);
    default: return null;
  }
}

const navItems = [
  { path: '/', label: 'Scanner', icon: 'scan' },
  { path: '/dashboard', label: 'Accueil', icon: 'home' },
  { path: '/history', label: 'Historique', icon: 'history' },
  { path: '/stats', label: 'Stats', icon: 'stats' },
];

const adminNavItem = { path: '/admin', label: 'Admin', icon: 'admin' };
const profileNavItem = { path: '/profile', label: 'Profil', icon: 'profile' };

export default function Layout() {
  const { user } = useAuth();
  const location = useLocation();
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [installPrompt, setInstallPrompt] = useState(null);
  const [installDismissed, setInstallDismissed] = useState(
    () => localStorage.getItem('pwa-install-dismissed') === '1'
  );

  const items = useMemo(() => {
    const list = [...navItems];
    if (user?.role === 'admin') {
      list.push(adminNavItem, profileNavItem);
    } else {
      list.push(profileNavItem);
    }
    return list;
  }, [user?.role]);

  // Check pending expenses count
  const refreshPendingCount = useCallback(async () => {
    try {
      const pending = await getPendingExpenses();
      setPendingCount(pending.filter(p => p.status !== 'failed').length);
    } catch {
      // IndexedDB may not be available
    }
  }, []);

  // Online/offline listeners + SW sync + periodic retry
  useEffect(() => {
    const onOnline = () => {
      setIsOnline(true);
      syncPending();
    };
    const onOffline = () => setIsOnline(false);
    const onSwSync = () => syncPending();

    const onInstallPrompt = (e) => {
      e.preventDefault();
      setInstallPrompt(e);
    };

    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    window.addEventListener('sw-sync-pending', onSwSync);
    window.addEventListener('beforeinstallprompt', onInstallPrompt);

    // Check pending on mount
    refreshPendingCount();

    // Periodic retry every 30s when online and there are pending items
    const retryInterval = setInterval(() => {
      if (navigator.onLine) {
        getPendingExpenses().then((pending) => {
          if (pending.filter(p => p.status !== 'failed').length > 0) {
            syncPending();
          }
        }).catch(() => {});
      }
    }, 30_000);

    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('sw-sync-pending', onSwSync);
      window.removeEventListener('beforeinstallprompt', onInstallPrompt);
      clearInterval(retryInterval);
    };
  }, []);

  // Sync pending expenses when back online
  const syncPending = useCallback(async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      const results = await syncPendingExpenses(async (expense) => {
        const formData = new FormData();
        formData.append('amount', expense.amount);
        formData.append('date_ticket', expense.date_ticket);
        formData.append('type', expense.type);
        if (expense.merchant) formData.append('merchant', expense.merchant);
        if (expense.description) formData.append('description', expense.description);
        // Reconstruct image file from IndexedDB stored data
        const imageFile = storableToFile(expense.imageData);
        console.log('[offline] Syncing expense:', expense.id, 'hasImageData:', !!expense.imageData, 'reconstructedFile:', !!imageFile, 'fileSize:', imageFile?.size || 0);
        if (imageFile) formData.append('image', imageFile);
        await api.submitScan(formData);
      });

      if (results.some(r => r.status === 'synced')) {
        console.log('[offline] Synced pending expenses:', results);
      }
    } catch (err) {
      console.error('[offline] Sync error:', err);
    } finally {
      setSyncing(false);
      refreshPendingCount();
    }
  }, [syncing, refreshPendingCount]);

  const handleInstall = useCallback(async () => {
    if (!installPrompt) return;
    haptic('medium');
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    if (outcome === 'accepted') setInstallPrompt(null);
  }, [installPrompt]);

  const dismissInstall = useCallback(() => {
    setInstallDismissed(true);
    localStorage.setItem('pwa-install-dismissed', '1');
  }, []);

  const showInstallBanner = installPrompt && !installDismissed;

  const activeIndex = items.findIndex((item) =>
    item.path === '/' ? location.pathname === '/' : location.pathname.startsWith(item.path)
  );

  const itemRefs = useRef([]);
  const [indicatorPos, setIndicatorPos] = useState({ left: 0, opacity: 0 });

  useLayoutEffect(() => {
    const el = itemRefs.current[activeIndex];
    if (!el) { setIndicatorPos(p => ({ ...p, opacity: 0 })); return; }
    setIndicatorPos({
      left: el.offsetLeft + el.offsetWidth / 2,
      opacity: 1,
    });
  }, [activeIndex]);

  return (
    <div className="min-h-screen bg-bg pb-24 app-shell-in">
      {/* Offline banner */}
      {!isOnline && (
        <div className="fixed top-0 left-0 right-0 z-[60] bg-amber-600 text-white text-xs text-center py-2 font-medium">
          Hors ligne — les d{'\u00E9'}penses seront envoy{'\u00E9'}es au retour du r{'\u00E9'}seau
        </div>
      )}

      {/* Pending sync banner */}
      {isOnline && pendingCount > 0 && (
        <div className="fixed top-0 left-0 right-0 z-[60] bg-green-mid/90 text-white text-xs text-center py-2 font-medium flex items-center justify-center gap-2">
          {syncing ? (
            <>
              <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Synchronisation en cours...
            </>
          ) : (
            <>
              {pendingCount} d{'\u00E9'}pense{pendingCount > 1 ? 's' : ''} en attente
              <button
                onClick={syncPending}
                className="ml-2 px-2 py-0.5 bg-white/20 rounded-full text-[10px] font-semibold"
              >
                Synchroniser
              </button>
            </>
          )}
        </div>
      )}

      {/* PWA Install banner */}
      {showInstallBanner && (
        <div className="fixed top-0 left-0 right-0 z-[55] bg-gradient-to-r from-green-deep to-green-mid/90 backdrop-blur-lg border-b border-green-mid/30 px-4 py-3">
          <div className="max-w-lg mx-auto flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center shrink-0">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-green-light">
                <path d="M12 5v14M5 12l7 7 7-7" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-white text-xs font-semibold">Installer l'application</p>
              <p className="text-white/60 text-[10px]">Acc{'è'}s rapide depuis l'{'é'}cran d'accueil</p>
            </div>
            <button
              onClick={handleInstall}
              className="px-3 py-1.5 rounded-full bg-green-light text-green-deep text-xs font-bold shrink-0"
            >
              Installer
            </button>
            <button
              onClick={dismissInstall}
              className="text-white/40 text-lg leading-none p-1 shrink-0"
            >
              {'×'}
            </button>
          </div>
        </div>
      )}

      <main className={`max-w-lg mx-auto px-4 pt-6 ${(!isOnline || showInstallBanner || (isOnline && pendingCount > 0)) ? 'mt-12' : ''}`}>
        <Outlet context={{ isOnline, refreshPendingCount }} />
      </main>

      {/* Bottom Navigation — named so it stays fixed during page transitions */}
      <nav className="fixed bottom-0 left-0 right-0 h-[84px] bg-black/95 backdrop-blur-xl border-t border-white/[0.08] z-50 [view-transition-name:bottom-nav]">
        <div className="relative max-w-lg mx-auto h-full flex items-center justify-around px-2">
          {/* Sliding active indicator (shared element via View Transitions) */}
          <span
            aria-hidden="true"
            className="pointer-events-none absolute top-0 h-[3px] w-7 rounded-full bg-green-light"
            style={{
              left: `${indicatorPos.left}px`,
              transform: 'translateX(-50%)',
              opacity: indicatorPos.opacity,
              viewTransitionName: 'nav-indicator',
              transition: 'left 0.34s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.2s ease',
              boxShadow: '0 0 12px rgba(127, 212, 114, 0.6)',
            }}
          />
          {items.map((item, idx) => {
            const isActive = item.path === '/'
              ? location.pathname === '/'
              : location.pathname.startsWith(item.path);

            return (
              <NavLink
                key={item.path}
                to={item.path}
                ref={el => { itemRefs.current[idx] = el; }}
                onClick={() => haptic('light')}
                viewTransition
                className={`flex flex-col items-center gap-1.5 py-2 px-3 transition-all duration-200 ${
                  isActive ? 'text-green-light' : 'text-text-dim'
                }`}
              >
                <span
                  className="transition-transform duration-300"
                  style={{
                    transform: isActive ? 'translateY(-2px) scale(1.12)' : 'none',
                    transitionTimingFunction: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
                  }}
                >
                  <NavIcon name={item.icon} active={isActive} />
                </span>
                <span className="text-[10px] font-medium tracking-wide">{item.label}</span>
              </NavLink>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
