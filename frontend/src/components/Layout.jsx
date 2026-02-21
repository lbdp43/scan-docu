import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { Outlet, NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getPendingExpenses, syncPendingExpenses, removePendingExpense, storableToFile } from '../utils/offline';
import { api } from '../utils/api';

const navItems = [
  { path: '/', label: 'Accueil', icon: '🏠' },
  { path: '/scan', label: 'Scanner', icon: '📷' },
  { path: '/history', label: 'Historique', icon: '📋' },
  { path: '/stats', label: 'Stats', icon: '📊' },
];

const adminNavItem = { path: '/admin', label: 'Admin', icon: '⚙️' };
const profileNavItem = { path: '/profile', label: 'Profil', icon: '👤' };

export default function Layout() {
  const { user } = useAuth();
  const location = useLocation();
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);

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

  // Online/offline listeners
  useEffect(() => {
    const onOnline = () => {
      setIsOnline(true);
      syncPending();
    };
    const onOffline = () => setIsOnline(false);

    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);

    // Check pending on mount
    refreshPendingCount();

    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
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

  return (
    <div className="min-h-screen bg-bg pb-24">
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

      <main className={`max-w-lg mx-auto px-4 pt-6 ${(!isOnline || (isOnline && pendingCount > 0)) ? 'mt-8' : ''}`}>
        <Outlet context={{ isOnline, refreshPendingCount }} />
      </main>

      {/* Bottom Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 h-[84px] bg-black/95 backdrop-blur-xl border-t border-white/[0.08] z-50">
        <div className="max-w-lg mx-auto h-full flex items-center justify-around px-2">
          {items.map(item => {
            const isActive = item.path === '/'
              ? location.pathname === '/'
              : location.pathname.startsWith(item.path);

            return (
              <NavLink
                key={item.path}
                to={item.path}
                className={`flex flex-col items-center gap-1 py-2 px-3 transition-all duration-200 ${
                  isActive ? 'text-green-light -translate-y-0.5' : 'text-text-dim'
                }`}
              >
                <span className="text-xl">{item.icon}</span>
                <span className="text-[10px] font-medium tracking-wide">{item.label}</span>
              </NavLink>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
