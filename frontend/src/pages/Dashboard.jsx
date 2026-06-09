import React, { useEffect, useState, useRef, useCallback } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../utils/api';
import { getPendingExpenses, removePendingExpense, storableToFile } from '../utils/offline';
import { useExpenseTypes } from '../context/ExpenseTypesContext';
import Toast from '../components/Toast';
import EditExpenseModal from '../components/EditExpenseModal';
import TypeIcon from '../components/TypeIcon';
import usePullToRefresh from '../hooks/usePullToRefresh.jsx';

const CACHE_KEY = 'dash_v2';
const CACHE_TTL = 3 * 60 * 1000;

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const { data, ts } = JSON.parse(raw);
    return Date.now() - ts < CACHE_TTL ? data : null;
  } catch { return null; }
}

function writeCache(data) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ data, ts: Date.now() }));
  } catch {}
}

const STATUS_ICONS = {
  uploaded: '✓',
  exported: '✓',
  pending: '···',
  error: '✗',
};

export default function Dashboard() {
  const { user } = useAuth();
  const { isOnline } = useOutletContext() || {};
  const { typesMap: TYPE_ICONS } = useExpenseTypes();
  const cached = readCache();
  const [stats, setStats] = useState(cached?.stats ?? null);
  const [recent, setRecent] = useState(cached?.recent ?? []);
  const [loading, setLoading] = useState(!cached);
  const [refreshing, setRefreshing] = useState(!!cached);
  const [editingExpense, setEditingExpense] = useState(null);
  const [toast, setToast] = useState(null);
  const [pendingExpenses, setPendingExpenses] = useState([]);
  const [myMissing, setMyMissing] = useState(null);
  const loadedRef = useRef(false);

  const loadData = useCallback(async () => {
    try {
      const [statsData, recentData] = await Promise.all([
        api.getStats(),
        api.getRecentExpenses(),
      ]);
      setStats(statsData);
      setRecent(recentData.expenses);
      writeCache({ stats: statsData, recent: recentData.expenses });
    } catch (err) {
      console.error('Dashboard load error:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const { containerRef, PullIndicator, isRefreshing: isPullRefreshing } = usePullToRefresh(
    useCallback(async () => {
      await loadData();
      await loadPending();
    }, [loadData])
  );

  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    loadData();
    loadPending();
    // Paiements carte sans justificatif (chargé à part — appel Pennylane plus lent)
    api.getMyMissingPayments().then(setMyMissing).catch(() => {});
  }, []);

  useEffect(() => {
    loadPending();
  }, [isOnline]);

  async function loadPending() {
    try {
      const pending = await getPendingExpenses();
      setPendingExpenses(pending.filter(p => p.status !== 'failed'));
    } catch {}
  }

  function getPendingImageUrl(expense) {
    if (!expense.imageData?.buffer) return null;
    try {
      const blob = new Blob([expense.imageData.buffer], { type: expense.imageData.type || 'image/jpeg' });
      return URL.createObjectURL(blob);
    } catch { return null; }
  }

  async function handleDeletePending(id) {
    try {
      await removePendingExpense(id);
      setPendingExpenses(prev => prev.filter(p => p.id !== id));
      setToast({ message: 'Dépense en attente supprimée', type: 'success' });
    } catch {
      setToast({ message: 'Erreur lors de la suppression', type: 'error' });
    }
  }

  const firstName = user?.name?.split(' ')[0] || 'Utilisateur';

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="flex items-center justify-between">
          <div>
            <div className="h-7 bg-card rounded-xl w-44" />
            <div className="h-4 bg-card rounded-lg w-32 mt-2" />
          </div>
          <div className="w-[42px] h-[42px] rounded-full bg-card" />
        </div>
        <div className="rounded-4xl p-7 bg-card h-52" />
        <div className="h-20 bg-card rounded-3xl" />
        <div className="h-16 bg-card rounded-3xl" />
        <div className="space-y-3 mt-4">
          {[1,2,3].map(i => <div key={i} className="h-[78px] bg-card rounded-3xl" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6" ref={containerRef}>
      {toast && <Toast {...toast} onClose={() => setToast(null)} />}

      <PullIndicator />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-serif text-[22px] font-semibold">
            Bonjour {firstName}
          </h1>
          <p className="text-text-muted text-sm mt-1">Vos notes de frais</p>
        </div>
        <div className="flex items-center gap-2">
          {(refreshing || isPullRefreshing) && (
            <span className="w-4 h-4 border-2 border-green-mid/30 border-t-green-light rounded-full animate-spin" />
          )}
          <div className="w-[42px] h-[42px] rounded-full bg-green-mid/30 flex items-center justify-center text-lg font-semibold text-green-light">
            {firstName[0]}
          </div>
        </div>
      </div>

      {/* Mes paiements à justifier (notification in-app) */}
      {myMissing?.summary?.missing > 0 && (
        <div className="rounded-3xl p-5 bg-amber-500/10 border border-amber-500/30 animate-fade-up">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-11 h-11 rounded-2xl bg-amber-500/20 flex items-center justify-center text-xl shrink-0">{'⚠️'}</div>
            <div className="flex-1 min-w-0">
              <p className="text-amber-300 font-semibold text-sm">
                {myMissing.summary.missing} paiement{myMissing.summary.missing > 1 ? 's' : ''} à justifier
              </p>
              <p className="text-text-muted text-xs">
                {Number(myMissing.summary.amountMissing).toFixed(2)} {'€'} {'·'} scanne le justificatif
              </p>
            </div>
          </div>
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {myMissing.transactions.slice(0, 30).map(tx => {
              const manualUrl = `/manual?amount=${encodeURIComponent(Number(tx.amount).toFixed(2))}&date=${encodeURIComponent(tx.date)}&merchant=${encodeURIComponent(tx.label || '')}`;
              return (
                <div key={tx.transactionId} className="p-2.5 rounded-xl bg-bg/40">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-text text-xs font-medium truncate">{tx.label || 'Paiement carte'}</p>
                      <p className="text-text-muted text-[10px]">
                        {new Date(tx.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
                        {tx.card?.label ? ` · ${tx.card.label}` : (tx.card?.last4 ? ` · •••• ${tx.card.last4}` : '')}
                      </p>
                    </div>
                    <p className="font-serif text-sm font-semibold text-amber-400 shrink-0">{Number(tx.amount).toFixed(2)}{'€'}</p>
                  </div>
                  <div className="flex gap-2 mt-2">
                    <Link viewTransition to="/" className="flex-1 text-center py-1.5 rounded-lg bg-green-mid/20 text-green-light text-[11px] font-medium transition-transform active:scale-[0.96]">
                      {'📷'} Scanner
                    </Link>
                    <Link viewTransition to={manualUrl} className="flex-1 text-center py-1.5 rounded-lg bg-card border border-card-border text-text-muted text-[11px] font-medium transition-transform active:scale-[0.96]">
                      {'✍️'} Saisie
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Hero Card — Monthly Total */}
      <div className="relative overflow-hidden rounded-4xl p-7"
        style={{ background: 'linear-gradient(135deg, #1C3A1E, #243F26)' }}>
        <div className="relative z-10">
          <p className="text-text-muted text-sm mb-2">Total du mois</p>
          <p className="font-serif text-[46px] font-bold text-white leading-tight">
            {stats?.month?.total ? Number(stats.month.total).toFixed(2) : '0.00'}
            <span className="text-2xl ml-1">{'€'}</span>
          </p>
        </div>

        {/* Stats row */}
        <div className="relative z-10 flex mt-6 pt-4 border-t border-white/10">
          {stats?.byType?.map((t, i) => {
            const typeInfo = TYPE_ICONS[t.type] || TYPE_ICONS.autre;
            return (
              <div key={t.type} className={`flex-1 text-center flex flex-col items-center ${i > 0 ? 'border-l border-white/10' : ''}`}>
                <span className="text-green-light/70"><TypeIcon icon={typeInfo.icon} color={typeInfo.hexColor} size={20} /></span>
                <p className="text-green-light font-semibold text-lg mt-1">{t.count}</p>
                <p className="text-text-muted text-[10px] uppercase tracking-wider">{t.type}</p>
              </div>
            );
          })}
          {(!stats?.byType || stats.byType.length === 0) && (
            <p className="text-text-muted text-sm text-center w-full">Aucune d{'é'}pense ce mois</p>
          )}
        </div>

        {/* Background decoration */}
        <div className="absolute top-4 right-4 opacity-[0.06] select-none">
          <svg width="70" height="70" viewBox="0 0 24 24" fill="currentColor" className="text-green-light"><path d="M17 8C8 10 5.9 16.17 3.82 21.34l1.89.66.95-2.71c.75.75 1.6 1.34 2.51 1.76C13.18 23.14 19 22 22 18c.91-1.22 1.38-2.66 1-4-.38-1.34-2.07-2-4-2-1.59 0-3.19.5-4.53 1.4-.52-.98-.84-2.09-.97-3.4z"/></svg>
        </div>
      </div>

      {/* Action Buttons */}
      <Link viewTransition
        to="/"
        className="flex items-center gap-4 w-full p-5 rounded-3xl transition-transform active:scale-[0.97]"
        style={{
          background: 'linear-gradient(135deg, #2D6A27, #4A9E40)',
          boxShadow: '0 4px 20px rgba(77, 158, 64, 0.3)',
        }}
      >
        <div className="w-12 h-12 rounded-2xl bg-white/10 flex items-center justify-center text-white/80">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="5" width="20" height="15" rx="3" /><circle cx="12" cy="13" r="4" /><path d="M8.5 5L9.5 3h5l1 2" /></svg>
        </div>
        <div className="flex-1">
          <p className="text-white font-semibold text-base">Scanner un ticket</p>
          <p className="text-white/60 text-xs mt-0.5">Tesseract analyse le ticket</p>
        </div>
        <span className="text-white/40 text-xl">{'›'}</span>
      </Link>

      <Link viewTransition
        to="/manual"
        className="flex items-center gap-4 w-full p-4 rounded-3xl border border-green-mid/30 bg-card transition-transform active:scale-[0.97]"
      >
        <div className="w-12 h-12 rounded-2xl bg-green-mid/10 flex items-center justify-center text-green-light">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
        </div>
        <div className="flex-1">
          <p className="text-text font-semibold text-base">Saisie sans ticket</p>
          <p className="text-text-muted text-xs mt-0.5">Saisie manuelle rapide</p>
        </div>
        <span className="text-text-dim text-xl">{'›'}</span>
      </Link>

      {/* Pending offline expenses */}
      {pendingExpenses.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3 px-1">
            <h2 className="text-amber-300/80 text-xs uppercase tracking-widest flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
              {pendingExpenses.length} en attente de sync
            </h2>
          </div>
          <div className="space-y-2">
            {pendingExpenses.map((expense) => {
              const typeInfo = TYPE_ICONS[expense.type] || TYPE_ICONS.autre;
              const imgUrl = getPendingImageUrl(expense);
              return (
                <div
                  key={expense.id}
                  className="flex items-center gap-3 p-3 rounded-2xl bg-amber-900/20 border border-amber-500/20"
                >
                  {imgUrl ? (
                    <img
                      src={imgUrl}
                      alt="Ticket"
                      className="w-[46px] h-[46px] rounded-xl object-cover"
                    />
                  ) : (
                    <div className={`w-[46px] h-[46px] rounded-xl flex items-center justify-center ${typeInfo.color}`}>
                      <TypeIcon icon={typeInfo.icon} color={typeInfo.hexColor} size={22} />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-text text-sm font-medium truncate">
                      {expense.merchant || 'Sans commerçant'}
                    </p>
                    <p className="text-amber-300/60 text-xs">
                      {expense.date_ticket} {'·'} {expense.type} {'·'} {navigator.onLine ? 'Synchronisation...' : 'Hors ligne'}
                    </p>
                  </div>
                  <div className="text-right shrink-0 flex items-center gap-2">
                    <p className="font-serif text-lg font-semibold text-text">
                      {Number(expense.amount).toFixed(2)}{'€'}
                    </p>
                    <button
                      onClick={() => handleDeletePending(expense.id)}
                      className="text-red-400/60 hover:text-red-400 text-xs p-1"
                      title="Supprimer"
                    >
                      {'✕'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Recent Tickets */}
      <div>
        <div className="flex items-center justify-between mb-3 px-1">
          <h2 className="text-text-muted text-xs uppercase tracking-widest">
            3 derniers tickets
          </h2>
        </div>
        <div className="space-y-3">
          {recent.map((expense, i) => {
            const typeInfo = TYPE_ICONS[expense.type] || TYPE_ICONS.autre;
            const date = new Date(expense.date_ticket).toLocaleDateString('fr-FR', {
              day: 'numeric', month: 'short',
            });
            return (
              <div
                key={expense.id}
                onClick={() => setEditingExpense(expense)}
                className={`flex items-center gap-3 p-4 rounded-3xl bg-card border border-card-border cursor-pointer transition-colors hover:border-green-mid/40 active:scale-[0.99] opacity-0 animate-fade-up stagger-${i + 1}`}
              >
                <div className={`w-[46px] h-[46px] rounded-2xl flex items-center justify-center ${typeInfo.color}`}>
                  {expense.has_receipt ? (
                    <TypeIcon icon={typeInfo.icon} color={typeInfo.hexColor} size={22} />
                  ) : (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-text text-sm font-medium truncate">
                    {expense.merchant || 'Sans commerçant'}
                  </p>
                  <p className="text-text-muted text-xs truncate">
                    {user?.role === 'admin' && expense.user?.name && (
                      <span className="text-green-light/80 font-medium">{expense.user.name} &middot; </span>
                    )}
                    {date} {'·'} {expense.type}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="font-serif text-lg font-semibold text-text">
                    {Number(expense.amount).toFixed(2)}{'€'}
                  </p>
                  <span className={`text-xs ${
                    expense.upload_status === 'error' ? 'text-red-400' :
                    expense.upload_status === 'uploaded' || expense.upload_status === 'exported' ? 'text-green-light' :
                    'text-text-dim'
                  }`}>
                    {expense.has_receipt
                      ? (STATUS_ICONS[expense.upload_status] || '···')
                      : ''}
                  </span>
                </div>
              </div>
            );
          })}
          {recent.length === 0 && (
            <p className="text-text-dim text-center py-8 text-sm">
              Aucun ticket soumis
            </p>
          )}
        </div>
      </div>

      <EditExpenseModal
        expense={editingExpense}
        onClose={() => setEditingExpense(null)}
        onSaved={(driveUpdated) => {
          setToast({
            message: driveUpdated ? 'Dépense modifiée et Drive mis à jour' : 'Dépense modifiée',
            type: 'success',
          });
          loadData();
        }}
        onDeleted={() => {
          setToast({ message: 'Dépense supprimée', type: 'success' });
          loadData();
        }}
      />
    </div>
  );
}
