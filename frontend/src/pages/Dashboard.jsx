import React, { useEffect, useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../utils/api';
import Toast from '../components/Toast';
import EditExpenseModal from '../components/EditExpenseModal';

const CACHE_KEY = 'dash_v2';
const CACHE_TTL = 3 * 60 * 1000; // 3 minutes

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

const TYPE_ICONS = {
  carburant: { icon: '⛽', color: 'bg-green-mid/20 text-green-light' },
  repas: { icon: '🍽️', color: 'bg-orange-500/20 text-orange-300' },
  peage: { icon: '🛣️', color: 'bg-blue-500/20 text-blue-300' },
  autre: { icon: '📄', color: 'bg-gray-500/20 text-gray-300' },
};

const STATUS_ICONS = {
  uploaded: '✅',
  pending: '⏳',
  error: '❌',
};

export default function Dashboard() {
  const { user } = useAuth();
  const cached = readCache();
  // Show cached data immediately — no spinner for returning users
  const [stats, setStats] = useState(cached?.stats ?? null);
  const [recent, setRecent] = useState(cached?.recent ?? []);
  const [loading, setLoading] = useState(!cached);
  const [refreshing, setRefreshing] = useState(!!cached); // silent background refresh
  const [editingExpense, setEditingExpense] = useState(null);
  const [toast, setToast] = useState(null);
  const loadedRef = useRef(false);

  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    loadData();
  }, []);

  async function loadData() {
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
    <div className="space-y-6 animate-fade-up">
      {toast && <Toast {...toast} onClose={() => setToast(null)} />}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-serif text-[22px] font-semibold">
            Bonjour {firstName} 👋
          </h1>
          <p className="text-text-muted text-sm mt-1">Vos notes de frais</p>
        </div>
        <div className="w-[42px] h-[42px] rounded-full bg-green-mid/30 flex items-center justify-center text-lg font-semibold text-green-light">
          {firstName[0]}
        </div>
      </div>

      {/* Hero Card — Monthly Total */}
      <div className="relative overflow-hidden rounded-4xl p-7"
        style={{ background: 'linear-gradient(135deg, #1C3A1E, #243F26)' }}>
        <div className="relative z-10">
          <p className="text-text-muted text-sm mb-2">Total du mois</p>
          <p className="font-serif text-[46px] font-bold text-white leading-tight">
            {stats?.month?.total ? Number(stats.month.total).toFixed(2) : '0.00'}
            <span className="text-2xl ml-1">€</span>
          </p>
        </div>

        {/* Stats row */}
        <div className="relative z-10 flex mt-6 pt-4 border-t border-white/10">
          {stats?.byType?.map((t, i) => {
            const typeInfo = TYPE_ICONS[t.type] || TYPE_ICONS.autre;
            return (
              <div key={t.type} className={`flex-1 text-center ${i > 0 ? 'border-l border-white/10' : ''}`}>
                <span className="text-lg">{typeInfo.icon}</span>
                <p className="text-green-light font-semibold text-lg mt-1">{t.count}</p>
                <p className="text-text-muted text-[10px] uppercase tracking-wider">{t.type}</p>
              </div>
            );
          })}
          {(!stats?.byType || stats.byType.length === 0) && (
            <p className="text-text-muted text-sm text-center w-full">Aucune dépense ce mois</p>
          )}
        </div>

        {/* Background decoration */}
        <div className="absolute top-4 right-4 text-[80px] opacity-[0.08] select-none">🌿</div>
      </div>

      {/* Action Buttons */}
      <Link
        to="/"
        className="flex items-center gap-4 w-full p-5 rounded-3xl transition-transform active:scale-[0.97]"
        style={{
          background: 'linear-gradient(135deg, #2D6A27, #4A9E40)',
          boxShadow: '0 4px 20px rgba(77, 158, 64, 0.3)',
        }}
      >
        <div className="w-12 h-12 rounded-2xl bg-white/10 flex items-center justify-center text-2xl">
          📷
        </div>
        <div className="flex-1">
          <p className="text-white font-semibold text-base">Scanner un ticket</p>
          <p className="text-white/60 text-xs mt-0.5">Tesseract analyse le ticket</p>
        </div>
        <span className="text-white/40 text-xl">›</span>
      </Link>

      <Link
        to="/manual"
        className="flex items-center gap-4 w-full p-4 rounded-3xl border border-green-mid/30 bg-card transition-transform active:scale-[0.97]"
      >
        <div className="w-12 h-12 rounded-2xl bg-green-mid/10 flex items-center justify-center text-2xl">
          ✏️
        </div>
        <div className="flex-1">
          <p className="text-text font-semibold text-base">Saisie sans ticket</p>
          <p className="text-text-muted text-xs mt-0.5">Saisie manuelle rapide</p>
        </div>
        <span className="text-text-dim text-xl">›</span>
      </Link>

      {/* Recent Tickets */}
      <div>
        <div className="flex items-center justify-between mb-3 px-1">
          <h2 className="text-text-muted text-xs uppercase tracking-widest">
            3 derniers tickets
          </h2>
          {refreshing && (
            <span className="w-3 h-3 border-2 border-green-mid/30 border-t-green-mid rounded-full animate-spin" />
          )}
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
                <div className={`w-[46px] h-[46px] rounded-2xl flex items-center justify-center text-xl ${typeInfo.color}`}>
                  {expense.has_receipt ? typeInfo.icon : '✏️'}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-text text-sm font-medium truncate">
                    {expense.merchant || 'Sans commerçant'}
                  </p>
                  <p className="text-text-muted text-xs truncate">
                    {user?.role === 'admin' && expense.user?.name && (
                      <span className="text-green-light/80 font-medium">{expense.user.name} &middot; </span>
                    )}
                    {date} · {expense.type}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="font-serif text-lg font-semibold text-text">
                    {Number(expense.amount).toFixed(2)}€
                  </p>
                  <span className="text-xs">
                    {expense.has_receipt
                      ? (STATUS_ICONS[expense.upload_status] || '⏳')
                      : '✏️'}
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
            message: driveUpdated ? 'D\u00E9pense modifi\u00E9e et Drive mis \u00E0 jour' : 'D\u00E9pense modifi\u00E9e',
            type: 'success',
          });
          loadData();
        }}
        onDeleted={() => {
          setToast({ message: 'D\u00E9pense supprim\u00E9e', type: 'success' });
          loadData();
        }}
      />
    </div>
  );
}
