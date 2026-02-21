import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { api } from '../utils/api';
import Toast from '../components/Toast';

const TYPE_ICONS = {
  carburant: { icon: '\u26FD', color: 'bg-green-mid/20 text-green-light' },
  repas: { icon: '\uD83C\uDF7D\uFE0F', color: 'bg-orange-500/20 text-orange-300' },
  peage: { icon: '\uD83D\uDEE3\uFE0F', color: 'bg-blue-500/20 text-blue-300' },
  autre: { icon: '\uD83D\uDCC4', color: 'bg-gray-500/20 text-gray-300' },
};

const EXPENSE_TYPES = [
  { value: 'carburant', label: 'Carburant', icon: '\u26FD' },
  { value: 'repas', label: 'Repas', icon: '\uD83C\uDF7D\uFE0F' },
  { value: 'peage', label: 'P\u00E9age', icon: '\uD83D\uDEE3\uFE0F' },
  { value: 'autre', label: 'Autre', icon: '\uD83D\uDCC4' },
];

const STATUS_ICONS = {
  uploaded: '\u2705',
  pending: '\u23F3',
  error: '\u274C',
};

const MONTHS = [
  'Janvier', 'F\u00E9vrier', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Ao\u00FBt', 'Septembre', 'Octobre', 'Novembre', 'D\u00E9cembre',
];

export default function History() {
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState('');
  const [filterMonth, setFilterMonth] = useState(String(new Date().getMonth() + 1));
  const [filterYear, setFilterYear] = useState(String(new Date().getFullYear()));
  const [searchQuery, setSearchQuery] = useState('');
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1 });
  const [toast, setToast] = useState(null);
  const searchTimeout = useRef(null);

  // Edit modal state
  const [editingExpense, setEditingExpense] = useState(null);
  const [editAmount, setEditAmount] = useState('');
  const [editDate, setEditDate] = useState('');
  const [editType, setEditType] = useState('autre');
  const [editMerchant, setEditMerchant] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editSaving, setEditSaving] = useState(false);

  // Receipt viewer state
  const [showReceipt, setShowReceipt] = useState(false);

  useEffect(() => {
    loadExpenses();
  }, [filterType, filterMonth, filterYear]);

  // Debounced search
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
    } catch (err) {
      console.error('Load expenses error:', err);
    } finally {
      setLoading(false);
    }
  }

  function openEdit(expense) {
    setEditingExpense(expense);
    setEditAmount(String(Number(expense.amount)));
    setEditDate(new Date(expense.date_ticket).toISOString().slice(0, 10));
    setEditType(expense.type);
    setEditMerchant(expense.merchant || '');
    setEditDescription(expense.description || '');
    setShowReceipt(false);
  }

  function closeEdit() {
    setEditingExpense(null);
    setEditSaving(false);
    setShowReceipt(false);
  }

  async function handleEditSubmit(e) {
    e.preventDefault();
    if (!editingExpense) return;

    const parsedAmount = parseFloat(editAmount);
    if (!parsedAmount || parsedAmount <= 0) {
      setToast({ message: 'Montant invalide', type: 'error' });
      return;
    }

    setEditSaving(true);
    try {
      await api.updateExpense(editingExpense.id, {
        amount: parsedAmount,
        date_ticket: editDate,
        type: editType,
        merchant: editMerchant.trim() || undefined,
        description: editDescription.trim() || undefined,
      });

      const driveUpdated = !!editingExpense.drive_file_id;
      setToast({
        message: driveUpdated
          ? 'D\u00E9pense modifi\u00E9e et Drive mis \u00E0 jour'
          : 'D\u00E9pense modifi\u00E9e',
        type: 'success',
      });
      closeEdit();
      await loadExpenses(pagination.page);
    } catch (err) {
      setToast({ message: err.message || 'Erreur lors de la modification', type: 'error' });
      setEditSaving(false);
    }
  }

  const total = useMemo(() => expenses.reduce((sum, e) => sum + Number(e.amount), 0), [expenses]);

  return (
    <div className="space-y-6 animate-fade-up">
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
        {Object.entries(TYPE_ICONS).map(([key, val]) => (
          <button
            key={key}
            onClick={() => setFilterType(key)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all ${
              filterType === key ? 'bg-green-mid/20 border border-green-mid text-green-light' : 'bg-card border border-card-border text-text-muted'
            }`}
          >
            {val.icon} {key}
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
                  onClick={() => openEdit(expense)}
                  className="flex items-center gap-3 p-4 rounded-3xl bg-card border border-card-border cursor-pointer transition-colors hover:border-green-mid/40 active:scale-[0.99]"
                >
                  <div className={`w-[46px] h-[46px] rounded-2xl flex items-center justify-center text-xl ${typeInfo.color}`}>
                    {expense.has_receipt ? typeInfo.icon : '\u270F\uFE0F'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-text text-sm font-medium truncate">
                      {expense.merchant || 'Sans commer\u00E7ant'}
                    </p>
                    <p className="text-text-muted text-xs">
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
                            className="text-green-light hover:underline cursor-pointer"
                          >
                            {'\uD83D\uDCC4'} Drive
                          </span>
                        ) : (
                          <span>{STATUS_ICONS[expense.upload_status] || '\u23F3'}</span>
                        )
                      ) : (
                        <span className="text-amber-400">{'\u26A0\uFE0F'} Sans ticket</span>
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

      {/* Edit Modal */}
      {editingExpense && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm" onClick={closeEdit}>
          <div
            className="bg-[#1a2a1c] border border-card-border rounded-t-3xl sm:rounded-3xl w-full max-w-md max-h-[85vh] sm:max-h-[90vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Fixed header */}
            <div className="flex items-center justify-between px-5 pt-5 pb-3 shrink-0">
              <h3 className="font-serif text-lg font-semibold text-text">Modifier la d{'\u00E9'}pense</h3>
              <button onClick={closeEdit} className="w-8 h-8 flex items-center justify-center rounded-full bg-card text-text-muted text-lg leading-none">{'\u00D7'}</button>
            </div>

            {/* Scrollable content */}
            <div className="overflow-y-auto flex-1 px-5 pb-5 overscroll-contain">
              {/* Receipt viewer toggle */}
              {editingExpense.drive_file_id && (
                <div className="mb-4 space-y-3">
                  <div className="flex items-center justify-between p-2.5 rounded-xl bg-green-mid/10 border border-green-mid/20">
                    <span className="text-xs text-green-light">
                      {'\uD83D\uDCC4'} Justificatif sur Drive
                    </span>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setShowReceipt(!showReceipt)}
                        className="px-3 py-1 rounded-lg bg-green-mid/20 text-xs text-green-light font-medium"
                      >
                        {showReceipt ? 'Masquer' : 'Voir'}
                      </button>
                      <a
                        href={api.getReceiptUrl(editingExpense.id)}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="px-3 py-1 rounded-lg bg-green-mid/20 text-xs text-green-light font-medium"
                      >
                        {'\u2B07'} PDF
                      </a>
                    </div>
                  </div>

                  {showReceipt && (
                    <div className="rounded-2xl overflow-hidden border border-card-border bg-white">
                      <iframe
                        src={api.getReceiptUrl(editingExpense.id)}
                        className="w-full h-[250px] sm:h-[300px]"
                        title="Justificatif"
                      />
                    </div>
                  )}
                </div>
              )}

              <form onSubmit={handleEditSubmit} className="space-y-3">
                {/* Amount + Date row */}
                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className="block text-[10px] uppercase tracking-widest text-text-muted mb-1">
                      Montant ({'\u20AC'})
                    </label>
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      min="0.01"
                      max="9999.99"
                      value={editAmount}
                      onChange={(e) => setEditAmount(e.target.value)}
                      required
                      className="w-full bg-bg border border-card-border rounded-xl px-3 py-2.5 text-text text-lg font-serif focus:outline-none focus:border-green-mid"
                    />
                  </div>
                  <div className="flex-1">
                    <label className="block text-[10px] uppercase tracking-widest text-text-muted mb-1">
                      Date
                    </label>
                    <input
                      type="date"
                      value={editDate}
                      onChange={(e) => setEditDate(e.target.value)}
                      max={new Date().toISOString().slice(0, 10)}
                      className="w-full bg-bg border border-card-border rounded-xl px-3 py-2.5 text-text text-sm focus:outline-none focus:border-green-mid [color-scheme:dark]"
                    />
                  </div>
                </div>

                {/* Type pills */}
                <div>
                  <label className="block text-[10px] uppercase tracking-widest text-text-muted mb-1">
                    Type
                  </label>
                  <div className="flex gap-1.5 flex-wrap">
                    {EXPENSE_TYPES.map(t => (
                      <button
                        key={t.value}
                        type="button"
                        onClick={() => setEditType(t.value)}
                        className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                          editType === t.value
                            ? 'bg-green-mid/20 border border-green-mid text-green-light'
                            : 'bg-card border border-card-border text-text-muted'
                        }`}
                      >
                        {t.icon} {t.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Merchant */}
                <div>
                  <label className="block text-[10px] uppercase tracking-widest text-text-muted mb-1">
                    Commer{'\u00E7'}ant
                  </label>
                  <input
                    type="text"
                    value={editMerchant}
                    onChange={(e) => setEditMerchant(e.target.value)}
                    maxLength={255}
                    placeholder="Nom du commer\u00E7ant"
                    className="w-full bg-bg border border-card-border rounded-xl px-3 py-2.5 text-text text-sm focus:outline-none focus:border-green-mid"
                  />
                </div>

                {/* Description */}
                <div>
                  <label className="block text-[10px] uppercase tracking-widest text-text-muted mb-1">
                    Description
                  </label>
                  <input
                    type="text"
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    maxLength={500}
                    placeholder="Description courte"
                    className="w-full bg-bg border border-card-border rounded-xl px-3 py-2.5 text-text text-sm focus:outline-none focus:border-green-mid"
                  />
                </div>

                {/* Buttons */}
                <div className="flex gap-3 pt-1 pb-2">
                  <button
                    type="button"
                    onClick={closeEdit}
                    className="flex-1 py-3 rounded-2xl bg-card border border-card-border text-text-muted font-medium text-sm transition-transform active:scale-[0.97]"
                  >
                    Annuler
                  </button>
                  <button
                    type="submit"
                    disabled={editSaving}
                    className="flex-1 py-3 rounded-2xl text-white font-semibold text-sm transition-transform active:scale-[0.97] disabled:opacity-50 flex items-center justify-center gap-2"
                    style={{
                      background: 'linear-gradient(135deg, #2D6A27, #4A9E40)',
                      boxShadow: '0 4px 20px rgba(77, 158, 64, 0.3)',
                    }}
                  >
                    {editSaving ? (
                      <>
                        <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        Envoi...
                      </>
                    ) : (
                      'Enregistrer'
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
