import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../utils/api';
import Toast from '../components/Toast';

const TYPE_ICONS = {
  carburant: { icon: '⛽', color: 'bg-green-mid/20 text-green-light' },
  repas: { icon: '🍽️', color: 'bg-orange-500/20 text-orange-300' },
  peage: { icon: '🛣️', color: 'bg-blue-500/20 text-blue-300' },
  autre: { icon: '📄', color: 'bg-gray-500/20 text-gray-300' },
};

export default function Admin() {
  const { user } = useAuth();
  const [stats, setStats] = useState(null);
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [filterUser, setFilterUser] = useState('');
  const [filterType, setFilterType] = useState('');

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    loadExpenses();
  }, [filterUser, filterType]);

  async function loadData() {
    try {
      const [statsData] = await Promise.all([
        api.getAdminStats(),
      ]);
      setStats(statsData);
      await loadExpenses();
    } catch (err) {
      console.error('Admin load error:', err);
    } finally {
      setLoading(false);
    }
  }

  async function loadExpenses() {
    try {
      const params = {};
      if (filterUser) params.user_id = filterUser;
      if (filterType) params.type = filterType;
      const data = await api.getAdminExpenses(params);
      setExpenses(data.expenses);
    } catch (err) {
      console.error(err);
    }
  }

  async function handleExportCSV() {
    try {
      const blob = await api.exportCSV({});
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `notes-de-frais-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      setToast({ message: 'Export CSV téléchargé', type: 'success' });
    } catch (err) {
      setToast({ message: 'Erreur export CSV', type: 'error' });
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin w-8 h-8 border-2 border-green-mid border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-up">
      {toast && <Toast {...toast} onClose={() => setToast(null)} />}

      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="font-serif text-xl font-semibold">Administration</h1>
        <span className="px-3 py-1 rounded-full text-xs font-medium bg-gold/10 border border-gold/30 text-gold">
          Admin {user?.name?.split(' ')[0]}
        </span>
      </div>

      {/* Stats hero */}
      <div className="relative overflow-hidden rounded-4xl p-7"
        style={{ background: 'linear-gradient(135deg, #1C3A1E, #243F26)' }}>
        <div className="relative z-10">
          <p className="text-text-muted text-sm mb-1">Total équipe — ce mois</p>
          <p className="font-serif text-[38px] font-bold text-green-light leading-tight">
            {stats?.month?.total ? Number(stats.month.total).toFixed(2) : '0.00'}
            <span className="text-xl ml-1">€</span>
          </p>
          <p className="text-text-muted text-sm mt-1">
            {stats?.month?.count || 0} justificatifs · {stats?.totals?.users || 0} collaborateurs
          </p>
        </div>
        <div className="absolute top-4 right-4 text-[70px] opacity-[0.08] select-none">🌿</div>
      </div>

      {/* Stats by type */}
      <div className="grid grid-cols-2 gap-3">
        {stats?.byType?.map(t => {
          const typeInfo = TYPE_ICONS[t.type] || TYPE_ICONS.autre;
          return (
            <div key={t.type} className="p-4 rounded-2xl bg-card border border-card-border">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xl">{typeInfo.icon}</span>
                <span className="text-text-muted text-xs capitalize">{t.type}</span>
              </div>
              <p className="font-serif text-lg font-semibold text-text">
                {Number(t.total).toFixed(2)} €
              </p>
              <p className="text-text-muted text-xs">{t.count} tickets</p>
            </div>
          );
        })}
      </div>

      {/* Collaborators */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-text-muted text-xs uppercase tracking-widest">Collaborateurs ce mois</h2>
          <Link to="/admin/users" className="text-green-light text-xs font-medium">
            Gérer →
          </Link>
        </div>
        <div className="space-y-2">
          {stats?.byUser?.map(u => (
            <div key={u.userId} className="flex items-center gap-3 p-3 rounded-2xl bg-card border border-card-border">
              <div className="w-10 h-10 rounded-full bg-green-mid/20 flex items-center justify-center text-sm font-semibold text-green-light">
                {u.name?.[0] || '?'}
              </div>
              <div className="flex-1">
                <p className="text-text text-sm font-medium">{u.name}</p>
                <p className="text-text-muted text-xs">{u.card_id || 'Pas de carte'} · {u.count} tickets</p>
              </div>
              <p className="font-serif text-base font-semibold text-green-light">
                {Number(u.total).toFixed(2)} €
              </p>
            </div>
          ))}
          {(!stats?.byUser || stats.byUser.length === 0) && (
            <p className="text-text-dim text-center py-4 text-sm">Aucune dépense ce mois</p>
          )}
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex gap-3">
        <button
          onClick={handleExportCSV}
          className="flex-1 py-3 rounded-2xl bg-gold/10 border border-gold/30 text-gold font-medium text-sm transition-transform active:scale-[0.97]"
        >
          📥 Export CSV
        </button>
        <Link
          to="/scan"
          className="flex-1 py-3 rounded-2xl bg-green-mid text-white font-medium text-sm text-center transition-transform active:scale-[0.97]"
        >
          📷 Scanner
        </Link>
      </div>

      {/* Recent expenses (all users) */}
      <div>
        <h2 className="text-text-muted text-xs uppercase tracking-widest mb-3">Dernières dépenses</h2>

        {/* Filters */}
        <div className="flex gap-2 mb-3 overflow-x-auto pb-1">
          <button
            onClick={() => setFilterType('')}
            className={`px-3 py-1 rounded-full text-xs whitespace-nowrap ${!filterType ? 'bg-green-mid/20 text-green-light' : 'bg-card text-text-muted'}`}
          >
            Tous
          </button>
          {Object.entries(TYPE_ICONS).map(([key, val]) => (
            <button
              key={key}
              onClick={() => setFilterType(key === filterType ? '' : key)}
              className={`px-3 py-1 rounded-full text-xs whitespace-nowrap ${filterType === key ? 'bg-green-mid/20 text-green-light' : 'bg-card text-text-muted'}`}
            >
              {val.icon} {key}
            </button>
          ))}
        </div>

        <div className="space-y-2">
          {expenses.slice(0, 20).map(expense => {
            const typeInfo = TYPE_ICONS[expense.type] || TYPE_ICONS.autre;
            const date = new Date(expense.date_ticket).toLocaleDateString('fr-FR', {
              day: 'numeric', month: 'short',
            });
            return (
              <div key={expense.id} className="flex items-center gap-3 p-3 rounded-2xl bg-card border border-card-border">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-lg ${typeInfo.color}`}>
                  {expense.has_receipt ? typeInfo.icon : '⚠️'}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-text text-sm font-medium truncate">
                      {expense.merchant || 'Sans commerçant'}
                    </p>
                    {!expense.has_receipt && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 whitespace-nowrap">
                        Sans ticket
                      </span>
                    )}
                  </div>
                  <p className="text-text-muted text-xs">{expense.user?.name} · {date}</p>
                </div>
                <p className="font-serif text-base font-semibold text-text shrink-0">
                  {Number(expense.amount).toFixed(2)}€
                </p>
              </div>
            );
          })}
          {expenses.length === 0 && (
            <p className="text-text-dim text-center py-8 text-sm">Aucune dépense</p>
          )}
        </div>
      </div>
    </div>
  );
}
