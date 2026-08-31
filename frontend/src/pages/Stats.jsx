import React, { useEffect, useState, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../utils/api';
import { useExpenseTypes } from '../context/ExpenseTypesContext';
import { eur } from '../utils/format';
import { localDate } from '../utils/format';
import TypeIcon from '../components/TypeIcon';

const MONTH_LABELS = {
  '01': 'Jan', '02': 'Fév', '03': 'Mar', '04': 'Avr',
  '05': 'Mai', '06': 'Juin', '07': 'Juil', '08': 'Aoû',
  '09': 'Sep', '10': 'Oct', '11': 'Nov', '12': 'Déc',
};

const MONTH_LABELS_FULL = {
  '01': 'Janvier', '02': 'Février', '03': 'Mars', '04': 'Avril',
  '05': 'Mai', '06': 'Juin', '07': 'Juillet', '08': 'Août',
  '09': 'Septembre', '10': 'Octobre', '11': 'Novembre', '12': 'Décembre',
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
    case 'lastmonth': {
      const from = new Date(y, m - 1, 1);
      const to = new Date(y, m, 0);
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
  return localDate(d);
}

const PERIODS = [
  { key: '1m', label: 'Ce mois' },
  { key: 'lastmonth', label: 'Mois dernier' },
  { key: '3m', label: '3 mois' },
  { key: '6m', label: '6 mois' },
  { key: '12m', label: '12 mois' },
  { key: 'year', label: String(new Date().getFullYear()) },
  { key: 'lastyear', label: String(new Date().getFullYear() - 1) },
  { key: 'custom', label: '📅 Perso' },
];

const PAYMENT_FILTERS = [
  { key: '', label: 'Tout' },
  { key: 'carte', label: 'Carte pro' },
  { key: 'note_frais', label: 'Notes de frais' },
  { key: 'caisse', label: 'Espèces caisse' },
  { key: 'virement', label: 'Virement' },
  { key: 'cheque', label: 'Chèque' },
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
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [paymentFilter, setPaymentFilter] = useState('');
  const [expandedMonth, setExpandedMonth] = useState(null);
  // Drill-down : liste des dépenses d'un collaborateur sélectionné
  const [userExpenses, setUserExpenses] = useState(null);
  const [loadingUserExp, setLoadingUserExp] = useState(false);
  const [drillType, setDrillType] = useState('');
  // Paiements carte non justifiés (snapshot des manquants) pour l'utilisateur sélectionné
  const [missingSnap, setMissingSnap] = useState(null);

  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    loadInitial();
  }, []);

  useEffect(() => {
    if (!loadedRef.current) return;
    loadStats();
  }, [selectedUserId, period, paymentFilter, customFrom, customTo]);

  // Charge la liste détaillée quand un collaborateur est sélectionné
  useEffect(() => {
    if (!loadedRef.current) return;
    setDrillType('');
    if (!selectedUserId) { setUserExpenses(null); return; }
    loadUserExpenses();
  }, [selectedUserId, period, paymentFilter, customFrom, customTo]);

  // Snapshot des paiements non justifiés (admin) — chargé une fois, utilisé pour
  // le tableau "Par collaborateur" ET le détail d'un collaborateur sélectionné.
  useEffect(() => {
    if (!isAdmin) return;
    api.getPennylaneMissing().then(setMissingSnap).catch(() => setMissingSnap(null));
  }, [isAdmin]);

  async function loadUserExpenses() {
    const r = currentRange();
    if (!r.ready) { setUserExpenses([]); return; }
    setLoadingUserExp(true);
    try {
      const params = { userId: selectedUserId, from: r.from, to: r.to, limit: 300 };
      if (paymentFilter) params.payment_method = paymentFilter;
      const data = await api.getExpenses(params);
      setUserExpenses(data.expenses || []);
    } catch (err) {
      console.error('User expenses error:', err);
      setUserExpenses([]);
    } finally {
      setLoadingUserExp(false);
    }
  }

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

  function currentRange() {
    if (period === 'custom') {
      return { from: customFrom, to: customTo, ready: !!(customFrom && customTo) };
    }
    const { from, to } = getDateRange(period);
    return { from: fmt(from), to: fmt(to), ready: true };
  }

  async function loadStats() {
    const r = currentRange();
    if (!r.ready) return; // période perso incomplète
    setLoading(true);
    try {
      const params = { from: r.from, to: r.to };
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

  function openReceipt(e) {
    if (e.drive_file_url) window.open(e.drive_file_url, '_blank');
    else if (e.has_receipt) window.open(api.getReceiptUrl(e.id), '_blank');
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
  const periodLabel = period === 'custom'
    ? (customFrom && customTo ? `${customFrom} → ${customTo}` : 'période perso')
    : (PERIODS.find(p => p.key === period)?.label || period);
  const activeMonths = monthly.filter(m => m.total > 0).length;

  // Paiements non justifiés par utilisateur (depuis le snapshot des manquants).
  // missByUser : tous les manquants (exercice). nonCatByUser : filtré sur la période
  // affichée -> montant "Non catégorisé" (paiements carte sans ticket) par utilisateur.
  const missByUser = {};
  const nonCatByUser = {};
  if (missingSnap) {
    const cardUserMap = {};
    (missingSnap.cards || []).forEach(c => { if (c.masked && c.userId != null) cardUserMap[c.masked] = String(c.userId); });
    const range = currentRange();
    (missingSnap.transactions || []).forEach(t => {
      const uid = t.card?.masked ? cardUserMap[t.card.masked] : null;
      if (uid) {
        if (!missByUser[uid]) missByUser[uid] = { count: 0, amount: 0 };
        missByUser[uid].count++;
        missByUser[uid].amount += Number(t.amount || 0);
      }
      const d = (t.date || '').slice(0, 10);
      if (range.ready && d >= range.from && d <= range.to) {
        const k = uid || '__none__';
        nonCatByUser[k] = (nonCatByUser[k] || 0) + Number(t.amount || 0);
      }
    });
  }
  // Montant "Non catégorisé" pour le périmètre affiché (1 collaborateur ou tous)
  const nonCatScope = selectedUserId
    ? (nonCatByUser[String(selectedUserId)] || 0)
    : Object.values(nonCatByUser).reduce((a, b) => a + b, 0);
  const NONCAT = { icon: '❓', label: 'Non catégorisée', hexColor: '#9CA3AF' };

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

      {/* Custom date range */}
      {period === 'custom' && (
        <div className="flex items-center gap-2 flex-wrap">
          <label className="text-text-muted text-xs">Du</label>
          <input
            type="date"
            value={customFrom}
            max={customTo || undefined}
            onChange={(e) => setCustomFrom(e.target.value)}
            className="bg-card border border-card-border rounded-xl px-3 py-2 text-text text-sm focus:outline-none focus:border-green-mid"
          />
          <label className="text-text-muted text-xs">au</label>
          <input
            type="date"
            value={customTo}
            min={customFrom || undefined}
            max={localDate()}
            onChange={(e) => setCustomTo(e.target.value)}
            className="bg-card border border-card-border rounded-xl px-3 py-2 text-text text-sm focus:outline-none focus:border-green-mid"
          />
          {!(customFrom && customTo) && (
            <span className="text-amber-400 text-[10px] w-full">Choisis une date de début et de fin</span>
          )}
        </div>
      )}

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
              {eur(summary.grandTotal)}
            </p>
            <p className="text-text-dim text-[10px] mt-0.5">
              {(PAYMENT_FILTERS.find(f => f.key === paymentFilter)?.label || 'Tout')}{selectedUserId ? ' · 1 personne' : ''}
            </p>
          </div>
          <div className="p-4 rounded-2xl bg-card border border-card-border">
            <p className="text-text-muted text-[10px] uppercase tracking-widest">Moyenne / mois actif</p>
            <p className="font-serif text-2xl font-bold text-text mt-1">
              {eur(summary.avgMonthly)}
            </p>
            <p className="text-text-dim text-[10px] mt-0.5">
              sur {summary.activeMonths ?? activeMonths} mois avec d{'é'}penses
            </p>
          </div>
          <div className="p-4 rounded-2xl bg-card border border-card-border">
            <p className="text-text-muted text-[10px] uppercase tracking-widest">Nb d{'é'}penses</p>
            <p className="font-serif text-2xl font-bold text-text mt-1">{summary.totalExpenses}</p>
            <p className="text-text-dim text-[10px] mt-0.5">
              sur {activeMonths} mois actif{activeMonths > 1 ? 's' : ''}
            </p>
          </div>
          <div className="p-4 rounded-2xl bg-card border border-card-border">
            <p className="text-text-muted text-[10px] uppercase tracking-widest">Tickets avec photo</p>
            <p className="font-serif text-2xl font-bold text-text mt-1">
              {summary.totalExpenses > 0
                ? `${Math.round((summary.withReceipt / summary.totalExpenses) * 100)}%`
                : '—'}
            </p>
            <p className="text-text-dim text-[10px] mt-0.5">
              {summary.withReceipt}/{summary.totalExpenses} tickets scann{'é'}s
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
                    monthly.length <= 6 ? 'text-[11px]' : 'text-[11px]'
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
                    monthly.length <= 6 ? 'text-[11px]' : 'text-[11px]'
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
                  <span className="text-[11px] text-text-dim leading-none">{m.count || ''}</span>
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
              <div className="mt-4 pt-4 border-t border-card-border/60 animate-fade-up">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-text text-sm font-semibold">
                    {MONTH_LABELS_FULL[monthKey]} {year}
                  </p>
                  <p className="font-serif text-lg font-bold text-green-light">
                    {eur(m.total)}
                  </p>
                </div>
                {Object.keys(byType).length > 0 ? (
                  <div className="space-y-2">
                    {Object.entries(byType)
                      .sort((a, b) => b[1] - a[1])
                      .map(([type, total]) => {
                        const info = typesMap[type] || typesMap.autre || { icon: '📄', label: type, hexColor: '#6B7280' };
                        const pct = m.total > 0 ? (total / m.total) * 100 : 0;
                        return (
                          <div key={type} className="flex items-center gap-2">
                            <TypeIcon icon={info.icon} color={info.hexColor} size={16} className="shrink-0" />
                            <span className="text-text text-xs flex-1">{info.label}</span>
                            <div className="w-20 h-1.5 rounded-full bg-card-border/50 overflow-hidden">
                              <div
                                className="h-full rounded-full"
                                style={{ width: `${pct}%`, backgroundColor: info.hexColor }}
                              />
                            </div>
                            <span className="text-text text-xs font-mono font-medium w-16 text-right">
                              {eur(total)}
                            </span>
                          </div>
                        );
                      })}
                  </div>
                ) : (
                  <p className="text-text-dim text-xs">Aucune d{'é'}pense ce mois</p>
                )}
                <p className="text-text-dim text-[10px] mt-2">{m.count} op{'é'}ration{m.count > 1 ? 's' : ''}</p>
              </div>
            );
          })()}
        </div>

        {/* Type Breakdown */}
        <div className="p-5 rounded-3xl bg-card border border-card-border mt-6">
          <p className="text-text-muted text-[10px] uppercase tracking-widest mb-1">R{'é'}partition par type</p>
          {nonCatScope > 0 && (
            <p className="text-text-dim text-[10px] mb-3">{'❓'} Non catégorisée = paiements carte sans ticket ({eur(nonCatScope)})</p>
          )}
          {(typeTotals.length > 0 || nonCatScope > 0) ? (
            <div className="space-y-3">
              {(nonCatScope > 0 ? [...typeTotals, { type: '__noncat__', total: nonCatScope }] : typeTotals)
                .sort((a, b) => b.total - a.total)
                .map((t) => {
                  const info = t.type === '__noncat__' ? NONCAT : (typesMap[t.type] || typesMap.autre || { icon: '📄', label: t.type, hexColor: '#6B7280' });
                  const denom = summary.grandTotal + nonCatScope;
                  const pct = denom > 0 ? (t.total / denom) * 100 : 0;
                  return (
                    <div key={t.type}>
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-2">
                          {t.type === '__noncat__' ? <span className="text-lg">{info.icon}</span> : <TypeIcon icon={info.icon} color={info.hexColor} size={18} className="shrink-0" />}
                          <span className="text-text text-sm font-medium">{info.label}</span>
                        </div>
                        <span className="text-text font-serif font-semibold">
                          {eur(t.total)}
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-card-border/50 overflow-hidden">
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
            <p className="text-text-dim text-sm text-center py-4">Aucune donn{'é'}e</p>
          )}
        </div>

        {/* Par collaborateur (admin, vue "Tous") */}
        {isAdmin && !selectedUserId && byUser.length > 0 && (
          <div className="p-5 rounded-3xl bg-card border border-card-border mt-6">
            <p className="text-text-muted text-[10px] uppercase tracking-widest mb-1">Par collaborateur</p>
            <p className="text-text-dim text-[10px] mb-4">D{'é'}pense de chacun sur la p{'é'}riode, par cat{'é'}gorie</p>
            <div className="space-y-3">
              {byUser.map((u) => {
                const cats = Object.entries(u.byType || {}).sort((a, b) => b[1] - a[1]);
                const pct = summary.grandTotal > 0 ? (u.total / summary.grandTotal) * 100 : 0;
                const mu = missByUser[String(u.userId)];
                const nonCat = nonCatByUser[String(u.userId)] || 0;
                return (
                  <button
                    key={u.userId}
                    onClick={() => setSelectedUserId(String(u.userId))}
                    className="w-full text-left p-3 rounded-2xl bg-bg border border-card-border active:scale-[0.99] transition-transform"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="w-7 h-7 rounded-full bg-green-mid/25 flex items-center justify-center text-green-light text-xs font-semibold shrink-0">
                          {(u.name || '?').charAt(0).toUpperCase()}
                        </div>
                        <span className="text-text text-sm font-medium truncate">{u.name}</span>
                      </div>
                      <span className="font-serif font-semibold text-green-light shrink-0">{eur(u.total)}</span>
                    </div>
                    {mu && mu.count > 0 && (
                      <p className="text-amber-400 text-[11px] mb-1">{'⚠️'} {mu.count} paiement{mu.count > 1 ? 's' : ''} non justifi{'é'}{mu.count > 1 ? 's' : ''} · {eur(mu.amount)}</p>
                    )}
                    <div className="h-1 rounded-full bg-card-border/50 overflow-hidden mb-2">
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: 'linear-gradient(90deg, #2D6A27, #5ABF50)' }} />
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-1">
                      {cats.map(([type, total]) => {
                        const info = typesMap[type] || typesMap.autre || { icon: '📄', label: type };
                        return (
                          <span key={type} className="text-[11px] text-text-muted whitespace-nowrap">
                            <TypeIcon icon={info.icon} color={info.hexColor} size={12} className="inline-block mr-1 align-[-1px]" />{info.label} <span className="text-text font-medium">{eur(total)}</span>
                          </span>
                        );
                      })}
                      {nonCat > 0 && (
                        <span className="text-[11px] text-amber-300/90 whitespace-nowrap">
                          <span className="mr-0.5">{'❓'}</span>Non catégorisée <span className="font-medium">{eur(nonCat)}</span>
                        </span>
                      )}
                    </div>
                    <p className="text-text-dim text-[10px] mt-1.5">
                      {u.count} d{'é'}pense{u.count > 1 ? 's' : ''}
                      {nonCat > 0 ? ` · total réel ${eur(u.total + nonCat)}` : ''} · voir le d{'é'}tail {'›'}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Paiements carte non justifiés du collaborateur (exercice en cours) */}
        {selectedUserId && missingSnap && (() => {
          const uid = String(selectedUserId);
          const userCards = (missingSnap.cards || []).filter(c => c.masked && String(c.userId) === uid);
          const maskedSet = new Set(userCards.map(c => c.masked));
          const miss = (missingSnap.transactions || []).filter(t => t.card?.masked && maskedSet.has(t.card.masked));
          const missAmount = miss.reduce((s, t) => s + Number(t.amount || 0), 0);
          if (userCards.length === 0) {
            return (
              <div className="p-5 rounded-3xl bg-card border border-card-border mt-6">
                <p className="text-text-muted text-[10px] uppercase tracking-widest mb-2">Paiements carte non justifi{'é'}s</p>
                <p className="text-text-dim text-xs">Aucune carte attribu{'é'}e {'à'} ce collaborateur.</p>
              </div>
            );
          }
          const cardTotal = userCards.reduce((s, c) => s + (c.total || 0), 0);
          const cardMatched = userCards.reduce((s, c) => s + (c.matched || 0), 0);
          return (
            <div className={`p-5 rounded-3xl mt-6 border ${miss.length > 0 ? 'bg-amber-500/5 border-amber-500/25' : 'bg-card border-card-border'}`}>
              <div className="flex items-center justify-between mb-1">
                <p className="text-text-muted text-[10px] uppercase tracking-widest">Paiements carte non justifi{'é'}s</p>
                <span className="text-text-dim text-[10px]">exercice en cours</span>
              </div>
              <p className="text-text-dim text-[11px] mb-1">
                {cardMatched}/{cardTotal} paiements carte justifi{'é'}s
              </p>
              {miss.length === 0 ? (
                <p className="text-green-400 text-sm mt-1">{'✓'} Tout est justifi{'é'} sur ses cartes</p>
              ) : (
                <>
                  <p className="text-amber-400 font-serif text-lg font-bold">{miss.length} paiement{miss.length > 1 ? 's' : ''} · {eur(missAmount)}</p>
                  {/* Récap par carte */}
                  <div className="flex flex-wrap gap-2 mt-2 mb-3">
                    {userCards.map(c => (
                      <span key={c.masked} className="text-[10px] text-text-muted bg-bg border border-card-border rounded-full px-2 py-0.5">
                        {c.label || (c.last4 ? `•••• ${c.last4}` : 'carte')} : {c.missing} manquant{c.missing > 1 ? 's' : ''}
                      </span>
                    ))}
                  </div>
                  <div className="space-y-1.5 max-h-[50vh] overflow-y-auto">
                    {miss.sort((a, b) => (a.date < b.date ? 1 : -1)).map(tx => {
                      const params = `amount=${encodeURIComponent(Number(tx.amount).toFixed(2))}&date=${encodeURIComponent(tx.date)}&merchant=${encodeURIComponent(tx.label || '')}`;
                      return (
                        <div key={tx.transactionId} className="p-2.5 rounded-xl bg-bg border border-card-border">
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-text text-xs font-medium truncate">{tx.label || 'Paiement carte'}</p>
                              <p className="text-text-muted text-[10px]">
                                {new Date(tx.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
                                {tx.card?.label ? ` · ${tx.card.label}` : (tx.card?.last4 ? ` · •••• ${tx.card.last4}` : '')}
                              </p>
                            </div>
                            <p className="font-serif text-sm font-semibold text-amber-400 shrink-0">{eur(tx.amount)}</p>
                          </div>
                          <div className="flex gap-2 mt-1.5">
                            <a href={`/?${params}`} className="flex-1 text-center py-2 rounded-lg bg-green-mid/20 text-green-light text-xs font-medium">{'📷'} Scanner</a>
                            <a href={`/manual?${params}`} className="flex-1 text-center py-2 rounded-lg bg-card border border-card-border text-text-muted text-xs font-medium">{'✍️'} Saisie</a>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          );
        })()}

        {/* Drill-down : dépenses détaillées du collaborateur sélectionné */}
        {selectedUserId && (
          <div className="p-5 rounded-3xl bg-card border border-card-border mt-6">
            {(() => {
              const list = userExpenses || [];
              const counts = {};
              list.forEach(e => { counts[e.type] = (counts[e.type] || 0) + 1; });
              const shown = drillType ? list.filter(e => e.type === drillType) : list;
              const uName = users.find(u => String(u.id) === String(selectedUserId))?.name || 'Collaborateur';
              const typesPresent = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
              return (
                <>
                  <p className="text-text-muted text-[10px] uppercase tracking-widest mb-1">D{'é'}penses de {uName}</p>
                  <p className="text-text-dim text-[10px] mb-3">Touche une cat{'é'}gorie pour filtrer, une ligne pour voir le justificatif</p>

                  {/* Category chips with counts */}
                  <div className="flex gap-1.5 overflow-x-auto pb-1 mb-3">
                    <button
                      onClick={() => setDrillType('')}
                      className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap ${!drillType ? 'bg-green-mid/20 border border-green-mid text-green-light' : 'bg-bg border border-card-border text-text-muted'}`}
                    >
                      Tout ({list.length})
                    </button>
                    {typesPresent.map(t => {
                      const info = typesMap[t] || typesMap.autre || { icon: '📄', label: t };
                      return (
                        <button
                          key={t}
                          onClick={() => setDrillType(t)}
                          className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap ${drillType === t ? 'bg-green-mid/20 border border-green-mid text-green-light' : 'bg-bg border border-card-border text-text-muted'}`}
                        >
                          <TypeIcon icon={info.icon} color={info.hexColor} size={12} className="inline-block mr-1 align-[-1px]" />{info.label} ({counts[t]})
                        </button>
                      );
                    })}
                  </div>

                  {loadingUserExp ? (
                    <div className="flex justify-center py-8"><span className="w-5 h-5 border-2 border-green-mid/30 border-t-green-mid rounded-full animate-spin" /></div>
                  ) : shown.length === 0 ? (
                    <p className="text-text-dim text-sm text-center py-6">Aucune d{'é'}pense</p>
                  ) : (
                    <div className="space-y-1.5 max-h-[60vh] overflow-y-auto">
                      {shown.map(e => {
                        const info = typesMap[e.type] || typesMap.autre || { icon: '📄', label: e.type };
                        return (
                          <button
                            key={e.id}
                            onClick={() => openReceipt(e)}
                            className="w-full flex items-center gap-3 p-3 rounded-xl bg-bg border border-card-border text-left active:scale-[0.98] transition-transform"
                          >
                            <TypeIcon icon={info.icon} color={info.hexColor} size={18} className="shrink-0" />
                            <div className="flex-1 min-w-0">
                              <p className="text-text text-sm font-medium truncate">{e.merchant || info.label}</p>
                              <p className="text-text-muted text-xs">
                                {new Date(e.date_ticket).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}
                                {e.has_receipt ? ' · 📎 justificatif' : ' · sans photo'}
                              </p>
                            </div>
                            <span className="font-serif font-semibold text-text shrink-0">{eur(e.amount)}</span>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-text-muted shrink-0"><path d="M9 18l6-6-6-6" /></svg>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        )}

        {/* Détail par mois — replié (le graphe donne déjà la tendance) */}
        <details className="p-5 rounded-3xl bg-card border border-card-border mt-6">
          <summary className="text-text-muted text-[10px] uppercase tracking-widest cursor-pointer select-none">D{'é'}tail par mois (tableau)</summary>
          <div className="mt-3">
          <div className="space-y-0">
            {monthly.map((m) => {
              const monthKey = m.month.split('-')[1];
              const year = m.month.split('-')[0];
              const pct = maxMonthTotal > 0 ? (m.total / maxMonthTotal) * 100 : 0;
              return (
                <div
                  key={m.month}
                  className="py-2.5 border-b border-card-border/60 last:border-0"
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className="text-text text-sm font-medium">
                        {MONTH_LABELS_FULL[monthKey]} {year}
                      </span>
                      <span className="text-text-dim text-xs">({m.count})</span>
                    </div>
                    <span className={`font-serif font-semibold ${m.total > 0 ? 'text-text' : 'text-text-dim'}`}>
                      {eur(m.total)}
                    </span>
                  </div>
                  {/* Mini progress bar */}
                  <div className="h-1 rounded-full bg-card-border/50 overflow-hidden">
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
        </details>
      </div>
    </div>
  );
}
