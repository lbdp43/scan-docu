import React, { useEffect, useState, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../utils/api';
import { useExpenseTypes } from '../context/ExpenseTypesContext';

const MONTH_LABELS = {
  '01': 'Jan', '02': 'F\u00E9v', '03': 'Mar', '04': 'Avr',
  '05': 'Mai', '06': 'Juin', '07': 'Juil', '08': 'Ao\u00FB',
  '09': 'Sep', '10': 'Oct', '11': 'Nov', '12': 'D\u00E9c',
};

const MONTH_LABELS_FULL = {
  '01': 'Janvier', '02': 'F\u00E9vrier', '03': 'Mars', '04': 'Avril',
  '05': 'Mai', '06': 'Juin', '07': 'Juillet', '08': 'Ao\u00FBt',
  '09': 'Septembre', '10': 'Octobre', '11': 'Novembre', '12': 'D\u00E9cembre',
};

const CACHE_KEY = 'stats_v2';
const CACHE_TTL = 2 * 60 * 1000;

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

function getDateRange(period) {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  switch (period) {
    case '1m': {
      const from = new Date(y, m, 1);
      const to = new Date(y, m + 1, 0);
      return { from, to };
    }
    case '3m': {
      const from = new Date(y, m - 2, 1);
      const to = new Date(y, m + 1, 0);
      return { from, to };
    }
    case '6m': {
      const from = new Date(y, m - 5, 1);
      const to = new Date(y, m + 1, 0);
      return { from, to };
    }
    case '12m': {
      const from = new Date(y, m - 11, 1);
      const to = new Date(y, m + 1, 0);
      return { from, to };
    }
    case 'year': {
      const from = new Date(y, 0, 1);
      const to = new Date(y, 11, 31);
      return { from, to };
    }
    case 'lastyear': {
      const from = new Date(y - 1, 0, 1);
      const to = new Date(y - 1, 11, 31);
      return { from, to };
    }
    default:
      return { from: new Date(y, m - 5, 1), to: new Date(y, m + 1, 0) };
  }
}

function fmt(d) {
  return d.toISOString().slice(0, 10);
}

const PERIODS = [
  { key: '1m', label: 'Ce mois' },
  { key: '3m', label: '3 mois' },
  { key: '6m', label: '6 mois' },
  { key: '12m', label: '12 mois' },
  { key: 'year', label: String(new Date().getFullYear()) },
  { key: 'lastyear', label: String(new Date().getFullYear() - 1) },
];

const PAYMENT_FILTERS = [
  { key: '', label: 'Tout' },
  { key: 'carte', label: 'Carte pro' },
  { key: 'note_frais', label: 'Notes de frais' },
  { key: 'caisse', label: 'Espèces caisse' },
];

export default function Stats() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const { typesMap } = useExpenseTypes();
  const cached = readCache();
  const loadedRef = useRef(false);

  const [data, setData] = useState(cached?.stats ?? null);
  const [loading, setLoading] = useState(!cached);
  const [users, setUsers] = useState(cached?.users ?? []);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [period, setPeriod] = useState('6m');
  const [paymentFilter, setPaymentFilter] = useState('');
  const [expandedMonth, setExpandedMonth] = useState(null);

  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    loadInitial();
  }, []);

  useEffect(() => {
    if (!loadedRef.current) return;
    loadStats();
  }, [selectedUserId, period, paymentFilter]);

  async function loadInitial() {
    try {
      const { from, to } = getDateRange('6m');
      const params = { from: fmt(from), to: fmt(to) };
      const promises = [api.getAdvancedStats(params)];
      if (isAdmin) promises.push(api.getUsers());

      const results = await Promise.all(promises);
      setData(results[0]);
      const usersList = results[1]?.users || results[1] || [];
      if (isAdmin) setUsers(usersList);
      writeCache({ stats: results[0], users: usersList });
    } catch (err) {
      console.error('Stats error:', err);
    } finally {
      setLoading(false);
    }
  }

  async function loadStats() {
    setLoading(true);
    try {
      const { from, to } = getDateRange(period);
      const params = { from: fmt(from), to: fmt(to) };
      if (selectedUserId) params.userId = selectedUserId;
      if (paymentFilter) params.payment_method = paymentFilter;
      const result = await api.getAdvancedStats(params);
      setData(result);
    } catch (err) {
      console.error('Stats error:', err);
    } finally {
      setLoading(false);
    }
  }

  if (loading && !data) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-7 bg-card rounded-xl w-44" />
        <div className="h-10 bg-card rounded-2xl" />
        <div className="grid grid-cols-2 gap-3">
          {[1,2,3,4].map(i => <div key={i} className="h-24 bg-card rounded-2xl" />)}
        </div>
        <div className="h-48 bg-card rounded-3xl" />
        <div className="h-32 bg-card rounded-3xl" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="space-y-6">
        <h1 className="font-serif text-xl font-semibold">Statistiques</h1>
        <p className="text-text-dim text-sm text-center py-12">Impossible de charger les statistiques</p>
      </div>
    );
  }

  const { monthly, typeTotals, summary, byUser = [] } = data;
  const maxMonthTotal = Math.max(...monthly.map(m => m.total), 1);
  const periodLabel = PERIODS.find(p => p.key === period)?.label || period;
  const activeMonths = monthly.filter(m => m.total > 0).length;
  const eur = (n) => Number(n || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';

  return (
    <div className="space-y-6">
      <h1 className="font-serif text-xl font-semibold">Statistiques</h1>

      {/* Period selector */}
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {PERIODS.map((p) => (
          <button
            key={p.key}
            onClick={() => setPeriod(p.key)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all ${
              period === p.key
                ? 'bg-green-mid/20 border border-green-mid text-green-light'
                : 'bg-card border border-card-border text-text-muted'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Payment method filter */}
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {PAYMENT_FILTERS.map((f) => (
          <button
            key={f.key || 'all'}
            onClick={() => setPaymentFilter(f.key)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all ${
              paymentFilter === f.key
                ? 'bg-green-mid/20 border border-green-mid text-green-light'
                : 'bg-card border border-card-border text-text-muted'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Admin: User filter */}
      {isAdmin && users.length > 0 && (
        <select
          value={selectedUserId}
          onChange={(e) => setSelectedUserId(e.target.value)}
          className="w-full bg-card border border-card-border rounded-xl px-3 py-2.5 text-text text-sm focus:outline-none focus:border-green-mid"
        >
          <option value="">Tous les utilisateurs</option>
          {users.map(u => (
            <option key={u.id} value={u.id}>{u.name} ({u.email})</option>
          ))}
        </select>
      )}

      {/* Loading overlay for filter changes */}
      <div className={loading ? 'opacity-50 pointer-events-none transition-opacity' : 'transition-opacity'}>
        {/* Summary Cards */}
        <div className="grid grid-cols-2 gap-3">
          <div className="p-4 rounded-2xl bg-card border border-card-border">
            <p className="text-text-muted text-[10px] uppercase tracking-widest">Total {periodLabel}</p>
            <p className="font-serif text-2xl font-bold text-green-light mt-1">
              {summary.grandTotal.toFixed(2)}{'\u20AC'}
            </p>
            <p className="text-text-dim text-[10px] mt-0.5">
              {(PAYMENT_FILTERS.find(f => f.key === paymentFilter)?.label || 'Tout')}{selectedUserId ? ' \u00B7 1 personne' : ''}
            </p>
          </div>
          <div className="p-4 rounded-2xl bg-card border border-card-border">
            <p className="text-text-muted text-[10px] uppercase tracking-widest">Moyenne / mois actif</p>
            <p className="font-serif text-2xl font-bold text-text mt-1">
              {summary.avgMonthly.toFixed(2)}{'\u20AC'}
            </p>
            <p className="text-text-dim text-[10px] mt-0.5">
              sur {summary.activeMonths ?? activeMonths} mois avec d{'\u00E9'}penses
            </p>
          </div>
          <div className="p-4 rounded-2xl bg-card border border-card-border">
            <p className="text-text-muted text-[10px] uppercase tracking-widest">Nb d{'\u00E9'}penses</p>
            <p className="font-serif text-2xl font-bold text-text mt-1">{summary.totalExpenses}</p>
            <p className="text-text-dim text-[10px] mt-0.5">
              sur {activeMonths} mois actif{activeMonths > 1 ? 's' : ''}
            </p>
          </div>
          <div className="p-4 rounded-2xl bg-card border border-card-border">
            <p className="text-text-muted text-[10px] uppercase tracking-widest">Avec justificatif</p>
            <p className="font-serif text-2xl font-bold text-text mt-1">
              {summary.totalExpenses > 0
                ? `${Math.round((summary.withReceipt / summary.totalExpenses) * 100)}%`
                : '\u2014'}
            </p>
            <p className="text-text-dim text-[10px] mt-0.5">
              {summary.withReceipt}/{summary.totalExpenses}
            </p>
          </div>
        </div>

        {/* Monthly Bar Chart — improved */}
        <div className="p-5 rounded-3xl bg-card border border-card-border mt-6">
          <div className="flex items-center justify-between mb-4">
            <p className="text-text-muted text-[10px] uppercase tracking-widest">Tendance mensuelle</p>
            <p className="text-text-dim text-[10px]">{monthly.length} mois</p>
          </div>
          <div className="flex items-end gap-1.5">
            {monthly.map((m) => {
              const monthKey = m.month.split('-')[1];
              const year = m.month.split('-')[0];
              // hauteur en px : le % ne s'applique pas dans une colonne à hauteur auto
              const BAR_MAX = monthly.length <= 6 ? 130 : 110;
              const px = m.total > 0 ? Math.max((m.total / maxMonthTotal) * BAR_MAX, 8) : 3;
              const isMax = m.total > 0 && m.total === maxMonthTotal;
              const isExpanded = expandedMonth === m.month;
              return (
                <div
                  key={m.month}
                  className="flex-1 flex flex-col items-center gap-1 cursor-pointer"
                  onClick={() => setExpandedMonth(isExpanded ? null : m.month)}
                >
                  {/* Amount label */}
                  <span className={`font-mono font-medium leading-none ${
                    monthly.length <= 6 ? 'text-[11px]' : 'text-[9px]'
                  } ${isMax ? 'text-green-light font-bold' : m.total > 0 ? 'text-text-muted' : 'text-transparent'}`}>
                    {m.total > 0 ? `${Math.round(m.total)}` : '·'}
                  </span>
                  {/* Bar */}
                  <div
                    className={`w-full rounded-t-lg transition-all duration-500 ${
                      isExpanded ? 'ring-2 ring-green-light/50' : ''
                    }`}
                    style={{
                      height: `${px}px`,
                      background: m.total > 0
                        ? (isMax ? 'linear-gradient(180deg, #7BDF70, #3D8A37)' : 'linear-gradient(180deg, #5ABF50, #2D6A27)')
                        : 'rgba(255,255,255,0.06)',
                      boxShadow: isMax ? '0 0 12px rgba(90,191,80,0.35)' : 'none',
                    }}
                  />
                  {/* Month label */}
                  <span className={`font-medium leading-none ${
                    monthly.length <= 6 ? 'text-[11px]' : 'text-[9px]'
                  } ${m.total > 0 ? 'text-text' : 'text-text-dim'}`}>
                    {MONTH_LABELS[monthKey] || monthKey}
                  </span>
                  {/* Year if 12m or more */}
                  {monthly.length > 6 && (
                    <span className="text-[8px] text-text-dim leading-none">
                      {year.slice(2)}
                    </span>
                  )}
                  {/* Count */}
                  <span className="text-[9px] text-text-dim leading-none">{m.count || ''}</span>
                </div>
              );
            })}
          </div>

          {/* Expanded month detail */}
          {expandedMonth && (() => {
            const m = monthly.find(x => x.month === expandedMonth);
            if (!m) return null;
            const monthKey = m.month.split('-')[1];
            const year = m.month.split('-')[0];
            const byType = m.byType || {};
            return (
              <div className="mt-4 pt-4 border-t border-white/5 animate-fade-up">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-text text-sm font-semibold">
                    {MONTH_LABELS_FULL[monthKey]} {year}
                  </p>
                  <p className="font-serif text-lg font-bold text-green-light">
                    {m.total.toFixed(2)}{'\u20AC'}
                  </p>
                </div>
                {Object.keys(byType).length > 0 ? (
                  <div className="space-y-2">
                    {Object.entries(byType)
                      .sort((a, b) => b[1] - a[1])
                      .map(([type, total]) => {
                        const info = typesMap[type] || typesMap.autre || { icon: '\uD83D\uDCC4', label: type, hexColor: '#6B7280' };
                        const pct = m.total > 0 ? (total / m.total) * 100 : 0;
                        return (
                          <div key={type} className="flex items-center gap-2">
                            <span className="text-sm">{info.icon}</span>
                            <span className="text-text text-xs flex-1">{info.label}</span>
                            <div className="w-20 h-1.5 rounded-full bg-white/5 overflow-hidden">
                              <div
                                className="h-full rounded-full"
                                style={{ width: `${pct}%`, backgroundColor: info.hexColor }}
                              />
                            </div>
                            <span className="text-text text-xs font-mono font-medium w-16 text-right">
                              {Number(total).toFixed(2)}{'\u20AC'}
                            </span>
                          </div>
                        );
                      })}
                  </div>
                ) : (
                  <p className="text-text-dim text-xs">Aucune d{'\u00E9'}pense ce mois</p>
                )}
                <p className="text-text-dim text-[10px] mt-2">{m.count} op{'\u00E9'}ration{m.count > 1 ? 's' : ''}</p>
              </div>
            );
          })()}
        </div>

        {/* Type Breakdown */}
        <div className="p-5 rounded-3xl bg-card border border-card-border mt-6">
          <p className="text-text-muted text-[10px] uppercase tracking-widest mb-4">R{'\u00E9'}partition par type</p>
          {typeTotals.length > 0 ? (
            <div className="space-y-3">
              {typeTotals
                .sort((a, b) => b.total - a.total)
                .map((t) => {
                  const info = typesMap[t.type] || typesMap.autre || { icon: '\uD83D\uDCC4', label: t.type, hexColor: '#6B7280' };
                  const pct = summary.grandTotal > 0 ? (t.total / summary.grandTotal) * 100 : 0;
                  return (
                    <div key={t.type}>
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-2">
                          <span className="text-lg">{info.icon}</span>
                          <span className="text-text text-sm font-medium">{info.label}</span>
                        </div>
                        <span className="text-text font-serif font-semibold">
                          {t.total.toFixed(2)}{'\u20AC'}
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-white/5 overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-700"
                          style={{
                            width: `${pct}%`,
                            backgroundColor: info.hexColor,
                          }}
                        />
                      </div>
                      <p className="text-text-dim text-[10px] mt-0.5 text-right">
                        {Math.round(pct)}%
                      </p>
                    </div>
                  );
                })}
            </div>
          ) : (
            <p className="text-text-dim text-sm text-center py-4">Aucune donn{'\u00E9'}e</p>
          )}
        </div>

        {/* Par collaborateur (admin, vue "Tous") */}
        {isAdmin && !selectedUserId && byUser.length > 0 && (
          <div className="p-5 rounded-3xl bg-card border border-card-border mt-6">
            <p className="text-text-muted text-[10px] uppercase tracking-widest mb-1">Par collaborateur</p>
            <p className="text-text-dim text-[10px] mb-4">D{'\u00E9'}pense de chacun sur la p{'\u00E9'}riode, par cat{'\u00E9'}gorie</p>
            <div className="space-y-3">
              {byUser.map((u) => {
                const cats = Object.entries(u.byType || {}).sort((a, b) => b[1] - a[1]);
                const pct = summary.grandTotal > 0 ? (u.total / summary.grandTotal) * 100 : 0;
                return (
                  <div key={u.userId} className="p-3 rounded-2xl bg-bg border border-card-border">
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="w-7 h-7 rounded-full bg-green-mid/25 flex items-center justify-center text-green-light text-xs font-semibold shrink-0">
                          {(u.name || '?').charAt(0).toUpperCase()}
                        </div>
                        <span className="text-text text-sm font-medium truncate">{u.name}</span>
                      </div>
                      <span className="font-serif font-semibold text-green-light shrink-0">{eur(u.total)}</span>
                    </div>
                    <div className="h-1 rounded-full bg-white/5 overflow-hidden mb-2">
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: 'linear-gradient(90deg, #2D6A27, #5ABF50)' }} />
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-1">
                      {cats.map(([type, total]) => {
                        const info = typesMap[type] || typesMap.autre || { icon: '\uD83D\uDCC4', label: type };
                        return (
                          <span key={type} className="text-[11px] text-text-muted whitespace-nowrap">
                            <span className="mr-0.5">{info.icon}</span>{info.label} <span className="text-text font-medium">{eur(total)}</span>
                          </span>
                        );
                      })}
                    </div>
                    <p className="text-text-dim text-[10px] mt-1.5">{u.count} d{'\u00E9'}pense{u.count > 1 ? 's' : ''}</p>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Monthly Detail Table */}
        <div className="p-5 rounded-3xl bg-card border border-card-border mt-6">
          <p className="text-text-muted text-[10px] uppercase tracking-widest mb-4">D{'\u00E9'}tail par mois</p>
          <div className="space-y-0">
            {monthly.map((m) => {
              const monthKey = m.month.split('-')[1];
              const year = m.month.split('-')[0];
              const pct = maxMonthTotal > 0 ? (m.total / maxMonthTotal) * 100 : 0;
              return (
                <div
                  key={m.month}
                  className="py-2.5 border-b border-white/5 last:border-0"
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className="text-text text-sm font-medium">
                        {MONTH_LABELS_FULL[monthKey]} {year}
                      </span>
                      <span className="text-text-dim text-xs">({m.count})</span>
                    </div>
                    <span className={`font-serif font-semibold ${m.total > 0 ? 'text-text' : 'text-text-dim'}`}>
                      {m.total.toFixed(2)}{'\u20AC'}
                    </span>
                  </div>
                  {/* Mini progress bar */}
                  <div className="h-1 rounded-full bg-white/5 overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${pct}%`,
                        background: m.total > 0 ? 'linear-gradient(90deg, #2D6A27, #5ABF50)' : 'transparent',
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
