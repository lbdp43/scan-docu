import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../utils/api';

const TYPE_INFO = {
  carburant: { icon: '\u26FD', label: 'Carburant', color: '#4A9E40' },
  repas: { icon: '\uD83C\uDF7D\uFE0F', label: 'Repas', color: '#F97316' },
  peage: { icon: '\uD83D\uDEE3\uFE0F', label: 'P\u00E9age', color: '#3B82F6' },
  autre: { icon: '\uD83D\uDCC4', label: 'Autre', color: '#6B7280' },
};

const MONTH_LABELS = {
  '01': 'Jan', '02': 'F\u00E9v', '03': 'Mar', '04': 'Avr',
  '05': 'Mai', '06': 'Juin', '07': 'Juil', '08': 'Ao\u00FB',
  '09': 'Sep', '10': 'Oct', '11': 'Nov', '12': 'D\u00E9c',
};

export default function Stats() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState([]);
  const [selectedUserId, setSelectedUserId] = useState('');

  useEffect(() => {
    loadStats();
    if (isAdmin) {
      api.getUsers().then(res => setUsers(res.users || res || [])).catch(() => {});
    }
  }, []);

  useEffect(() => {
    loadStats();
  }, [selectedUserId]);

  async function loadStats() {
    setLoading(true);
    try {
      const params = {};
      if (selectedUserId) params.userId = selectedUserId;
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
        <div className="h-48 bg-card rounded-4xl" />
        <div className="h-32 bg-card rounded-3xl" />
        <div className="h-32 bg-card rounded-3xl" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="space-y-6 animate-fade-up">
        <h1 className="font-serif text-xl font-semibold">Statistiques</h1>
        <p className="text-text-dim text-sm text-center py-12">Impossible de charger les statistiques</p>
      </div>
    );
  }

  const { monthly, typeTotals, summary } = data;
  const maxMonthTotal = Math.max(...monthly.map(m => m.total), 1);

  return (
    <div className="space-y-6 animate-fade-up">
      <h1 className="font-serif text-xl font-semibold">Statistiques</h1>

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
      <div className={loading ? 'opacity-50 pointer-events-none' : ''}>
        {/* Summary Cards */}
        <div className="grid grid-cols-2 gap-3">
          <div className="p-4 rounded-2xl bg-card border border-card-border">
            <p className="text-text-muted text-[10px] uppercase tracking-widest">Total 6 mois</p>
            <p className="font-serif text-2xl font-bold text-green-light mt-1">
              {summary.grandTotal.toFixed(2)}{'\u20AC'}
            </p>
          </div>
          <div className="p-4 rounded-2xl bg-card border border-card-border">
            <p className="text-text-muted text-[10px] uppercase tracking-widest">Moyenne / mois</p>
            <p className="font-serif text-2xl font-bold text-text mt-1">
              {summary.avgMonthly.toFixed(2)}{'\u20AC'}
            </p>
          </div>
          <div className="p-4 rounded-2xl bg-card border border-card-border">
            <p className="text-text-muted text-[10px] uppercase tracking-widest">Nb d{'\u00E9'}penses</p>
            <p className="font-serif text-2xl font-bold text-text mt-1">{summary.totalExpenses}</p>
          </div>
          <div className="p-4 rounded-2xl bg-card border border-card-border">
            <p className="text-text-muted text-[10px] uppercase tracking-widest">Avec justificatif</p>
            <p className="font-serif text-2xl font-bold text-text mt-1">
              {summary.totalExpenses > 0
                ? `${Math.round((summary.withReceipt / summary.totalExpenses) * 100)}%`
                : '\u2014'}
            </p>
          </div>
        </div>

        {/* Monthly Bar Chart */}
        <div className="p-5 rounded-3xl bg-card border border-card-border mt-6">
          <p className="text-text-muted text-[10px] uppercase tracking-widest mb-4">Tendance mensuelle</p>
          <div className="flex items-end gap-2 h-40">
            {monthly.map((m) => {
              const monthKey = m.month.split('-')[1];
              const height = maxMonthTotal > 0 ? (m.total / maxMonthTotal) * 100 : 0;
              return (
                <div key={m.month} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-[10px] text-text-muted">
                    {m.total > 0 ? `${Math.round(m.total)}` : ''}
                  </span>
                  <div
                    className="w-full rounded-t-lg transition-all duration-500"
                    style={{
                      height: `${Math.max(height, 2)}%`,
                      background: m.total > 0
                        ? 'linear-gradient(180deg, #4A9E40, #2D6A27)'
                        : 'rgba(255,255,255,0.05)',
                    }}
                  />
                  <span className="text-[10px] text-text-muted font-medium">
                    {MONTH_LABELS[monthKey] || monthKey}
                  </span>
                  <span className="text-[9px] text-text-dim">{m.count}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Type Breakdown */}
        <div className="p-5 rounded-3xl bg-card border border-card-border mt-6">
          <p className="text-text-muted text-[10px] uppercase tracking-widest mb-4">R{'\u00E9'}partition par type</p>
          {typeTotals.length > 0 ? (
            <div className="space-y-3">
              {typeTotals
                .sort((a, b) => b.total - a.total)
                .map((t) => {
                  const info = TYPE_INFO[t.type] || TYPE_INFO.autre;
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
                            backgroundColor: info.color,
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

        {/* Monthly Detail Table */}
        <div className="p-5 rounded-3xl bg-card border border-card-border mt-6">
          <p className="text-text-muted text-[10px] uppercase tracking-widest mb-4">D{'\u00E9'}tail par mois</p>
          <div className="space-y-2">
            {monthly.map((m) => {
              const monthKey = m.month.split('-')[1];
              const year = m.month.split('-')[0];
              return (
                <div
                  key={m.month}
                  className="flex items-center justify-between py-2 border-b border-white/5 last:border-0"
                >
                  <div>
                    <span className="text-text text-sm font-medium">
                      {MONTH_LABELS[monthKey]} {year}
                    </span>
                    <span className="text-text-dim text-xs ml-2">({m.count} op.)</span>
                  </div>
                  <span className="font-serif font-semibold text-text">
                    {m.total.toFixed(2)}{'\u20AC'}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
