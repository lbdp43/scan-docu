import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { api } from '../utils/api';
import { useAuth } from '../context/AuthContext';
import { useExpenseTypes } from '../context/ExpenseTypesContext';
import Toast from '../components/Toast';
import EditExpenseModal from '../components/EditExpenseModal';
import TypeIcon from '../components/TypeIcon';

const STATUS_ICONS = {
  uploaded: '\u2713',
  exported: '\u2713',
  pending: '\u00B7\u00B7\u00B7',
  error: '\u2717',
};

const MONTHS = [
  'Janvier', 'F\u00E9vrier', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Ao\u00FBt', 'Septembre', 'Octobre', 'Novembre', 'D\u00E9cembre',
];

const CACHE_KEY = 'history_v1';
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

export default function History() {
  const { user: authUser } = useAuth();
  const isAdmin = authUser?.role === 'admin';
  const { types: expenseTypes, typesMap: TYPE_ICONS } = useExpenseTypes();
  const cached = readCache();
  const [expenses, setExpenses] = useState(cached?.expenses ?? []);
  const [loading, setLoading] = useState(!cached);
  const [filterType, setFilterType] = useState('');
  const [filterMonth, setFilterMonth] = useState(String(new Date().getMonth() + 1));
  const [filterYear, setFilterYear] = useState(String(new Date().getFullYear()));
  const [searchQuery, setSearchQuery] = useState('');
  const [pagination, setPagination] = useState(cached?.pagination ?? { page: 1, totalPages: 1 });
  const [toast, setToast] = useState(null);
  const searchTimeout = useRef(null);
  const [editingExpense, setEditingExpense] = useState(null);

  useEffect(() => {
    loadExpenses();
  }, [filterType, filterMonth, filterYear]);

  const handleSearchChange = useCallback((value) => {
    setSearchQuery(value);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => {
      loadExpenses(1, value);
    }, 400);
  }, [filterType, filterMonth, filterYear]);

  async function loadExpenses(page = 1, q = searchQuery) {
    setLoading(true);
    try {
      const params = { page, limit: 20 };
      if (filterType) params.type = filterType;
      if (filterMonth) params.month = filterMonth;
      if (filterYear) params.year = filterYear;
      if (q && q.trim()) params.q = q.trim();

      const data = await api.getExpenses(params);
      setExpenses(data.expenses);
      setPagination(data.pagination);
      if (page === 1 && !q && !filterType) {
        writeCache({ expenses: data.expenses, pagination: data.pagination });
      }
    } catch (err) {
      console.error('Load expenses error:', err);
    } finally {
      setLoading(false);
    }
  }

  const total = useMemo(() => expenses.reduce((sum, e) => sum + Number(e.amount), 0), [expenses]);

  return (
    <div className="space-y-6">
      {toast && <Toast {...toast} onClose={() => setToast(null)} />}

      <h1 className="font-serif text-xl font-semibold">Historique</h1>

      {/* Search bar */}
      <div className="relative">
        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-text-muted text-sm">
          {'\uD83D\uDD0D'}
        </span>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => handleSearchChange(e.target.value)}
          placeholder="Rechercher (commercant, description...)"
          className="w-full bg-card border border-card-border rounded-2xl pl-10 pr-4 py-3 text-text text-sm focus:outline-none focus:border-green-mid"
        />
        {searchQuery && (
          <button
            onClick={() => { setSearchQuery(''); loadExpenses(1, ''); }}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted text-lg leading-none"
          >
            {'\u00D7'}
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="flex gap-2 overflow-x-auto pb-2">
        <button
          onClick={() => setFilterType('')}
          className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all ${
            !filterType ? 'bg-green-mid/20 border border-green-mid text-green-light' : 'bg-card border border-card-border text-text-muted'
          }`}
        >
          Tous
        </button>
        {expenseTypes.map((t) => (
          <button
            key={t.value}
            onClick={() => setFilterType(t.value)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all ${
              filterType === t.value ? 'bg-green-mid/20 border border-green-mid text-green-light' : 'bg-card border border-card-border text-text-muted'
            }`}
          >
            <TypeIcon icon={t.icon} color={t.color} size={14} /> {t.label}
          </button>
        ))}
      </div>

      {/* Month/Year filter */}
      <div className="flex gap-2">
        <select
          value={filterMonth}
          onChange={(e) => setFilterMonth(e.target.value)}
          className="flex-1 bg-card border border-card-border rounded-xl px-3 py-2.5 text-text text-sm focus:outline-none focus:border-green-mid"
        >
          <option value="">Tous les mois</option>
          {MONTHS.map((m, i) => (
            <option key={i} value={String(i + 1)}>{m}</option>
          ))}
        </select>
        <select
          value={filterYear}
          onChange={(e) => setFilterYear(e.target.value)}
          className="bg-card border border-card-border rounded-xl px-3 py-2.5 text-text text-sm focus:outline-none focus:border-green-mid"
        >
          <option value="2026">2026</option>
          <option value="2025">2025</option>
        </select>
      </div>

      {/* Total */}
      <div className="p-4 rounded-2xl bg-card border border-card-border flex items-center justify-between">
        <span className="text-text-muted text-sm">Total affich{'\u00E9'}</span>
        <span className="font-serif text-xl font-semibold text-green-light">{total.toFixed(2)} {'\u20AC'}</span>
      </div>

      {/* Loading */}
      {loading ? (
        <div className="space-y-3 animate-pulse">
          {[1,2,3,4,5].map(i => (
            <div key={i} className="flex items-center gap-3 p-4 rounded-3xl bg-card border border-card-border">
              <div className="w-[46px] h-[46px] rounded-2xl bg-white/5" />
              <div className="flex-1 space-y-2">
                <div className="h-4 bg-white/5 rounded w-3/4" />
                <div className="h-3 bg-white/5 rounded w-1/2" />
              </div>
              <div className="h-5 bg-white/5 rounded w-16" />
            </div>
          ))}
        </div>
      ) : (
        <>
          {/* Expense List */}
          <div className="space-y-3">
            {expenses.map((expense) => {
              const typeInfo = TYPE_ICONS[expense.type] || TYPE_ICONS.autre;
              const date = new Date(expense.date_ticket).toLocaleDateString('fr-FR', {
                day: 'numeric', month: 'short', year: 'numeric',
              });
              return (
                <div
                  key={expense.id}
                  onClick={() => setEditingExpense(expense)}
                  className="flex items-center gap-3 p-4 rounded-3xl bg-card border border-card-border cursor-pointer transition-colors hover:border-green-mid/40 active:scale-[0.99]"
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
                      {expense.merchant || 'Sans commer\u00E7ant'}
                    </p>
                    <p className="text-text-muted text-xs truncate">
                      {isAdmin && expense.user?.name && (
                        <span className="text-green-light/80 font-medium">{expense.user.name} &middot; </span>
                      )}
                      {date}
                      {expense.description && ` \u00B7 ${expense.description}`}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-serif text-lg font-semibold text-text">
                      {Number(expense.amount).toFixed(2)}{'\u20AC'}
                    </p>
                    <div className="flex items-center justify-end gap-1 text-xs">
                      {expense.has_receipt ? (
                        expense.drive_file_url ? (
                          <span
                            onClick={(e) => { e.stopPropagation(); window.open(expense.drive_file_url, '_blank'); }}
                            className="text-green-light hover:underline cursor-pointer font-medium"
                          >
                            Drive
                          </span>
                        ) : (
                          <span className={
                            expense.upload_status === 'error' ? 'text-red-400' :
                            expense.upload_status === 'uploaded' || expense.upload_status === 'exported' ? 'text-green-light' :
                            'text-text-dim'
                          }>{STATUS_ICONS[expense.upload_status] || '\u00B7\u00B7\u00B7'}</span>
                        )
                      ) : (
                        <span className="text-amber-400/70 text-[10px]">sans re{'\u00E7'}u</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
            {expenses.length === 0 && (
              <p className="text-text-dim text-center py-12 text-sm">Aucune d{'\u00E9'}pense trouv{'\u00E9'}e</p>
            )}
          </div>

          {/* Pagination */}
          {pagination.totalPages > 1 && (
            <div className="flex justify-center gap-2">
              {Array.from({ length: pagination.totalPages }, (_, i) => i + 1).map(page => (
                <button
                  key={page}
                  onClick={() => loadExpenses(page)}
                  className={`w-8 h-8 rounded-full text-sm ${
                    pagination.page === page
                      ? 'bg-green-mid text-white'
                      : 'bg-card text-text-muted'
                  }`}
                >
                  {page}
                </button>
              ))}
            </div>
          )}
        </>
      )}

      <EditExpenseModal
        expense={editingExpense}
        onClose={() => setEditingExpense(null)}
        onSaved={(driveUpdated) => {
          setToast({
            message: driveUpdated ? 'D\u00E9pense modifi\u00E9e et Drive mis \u00E0 jour' : 'D\u00E9pense modifi\u00E9e',
            type: 'success',
          });
          loadExpenses(pagination.page);
        }}
        onDeleted={() => {
          setToast({ message: 'D\u00E9pense supprim\u00E9e', type: 'success' });
          loadExpenses(pagination.page);
        }}
      />
    </div>
  );
}
