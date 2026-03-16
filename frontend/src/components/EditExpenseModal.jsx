import React, { useState, useEffect } from 'react';
import { api } from '../utils/api';
import { useAuth } from '../context/AuthContext';
import { useExpenseTypes } from '../context/ExpenseTypesContext';
import TypeIcon from './TypeIcon';

export default function EditExpenseModal({ expense, onClose, onSaved, onDeleted }) {
  const { types: EXPENSE_TYPES } = useExpenseTypes();
  const { user: authUser } = useAuth();
  const isAdmin = authUser?.role === 'admin';
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState('');
  const [type, setType] = useState('autre');
  const [merchant, setMerchant] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [showReceipt, setShowReceipt] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (expense) {
      setAmount(String(Number(expense.amount)));
      setDate(new Date(expense.date_ticket).toISOString().slice(0, 10));
      setType(expense.type);
      setMerchant(expense.merchant || '');
      setDescription(expense.description || '');
      setShowReceipt(false);
      setShowDeleteConfirm(false);
      setError(null);
      // Lock body scroll
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = ''; };
    } else {
      document.body.style.overflow = '';
    }
  }, [expense]);

  if (!expense) return null;

  async function handleSubmit(e) {
    e.preventDefault();
    const parsedAmount = parseFloat(amount);
    if (!parsedAmount || parsedAmount <= 0) {
      setError('Montant invalide');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await api.updateExpense(expense.id, {
        amount: parsedAmount,
        date_ticket: date,
        type,
        merchant: merchant.trim() || undefined,
        description: description.trim() || undefined,
      });
      onSaved?.(!!expense.drive_file_id);
      onClose();
    } catch (err) {
      setError(err.message || 'Erreur lors de la modification');
      setSaving(false);
    }
  }

  async function handleRetryDrive() {
    setRetrying(true);
    setError(null);
    try {
      const result = await api.retryDriveUpload(expense.id);
      onSaved?.(true);
      onClose();
    } catch (err) {
      setError(err.message || 'Erreur lors du renvoi vers Drive');
      setRetrying(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    setError(null);
    try {
      await api.deleteExpense(expense.id);
      onDeleted?.();
      onClose();
    } catch (err) {
      setError(err.message || 'Erreur lors de la suppression');
      setDeleting(false);
      setShowDeleteConfirm(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center px-4 pb-[100px] pt-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-[#1a2a1c] border border-card-border rounded-3xl w-full max-w-md max-h-full flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Fixed header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3 shrink-0">
          <div>
            <h3 className="font-serif text-lg font-semibold text-text">Modifier la d{'\u00E9'}pense</h3>
            {isAdmin && expense.user?.name && (
              <p className="text-xs text-green-light/80 mt-0.5">Par {expense.user.name}</p>
            )}
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full bg-card text-text-muted text-lg leading-none">{'\u00D7'}</button>
        </div>

        {/* Scrollable content */}
        <div className="overflow-y-auto flex-1 px-5 pb-5 overscroll-contain">
          {/* Error */}
          {error && (
            <div className="mb-3 p-2.5 rounded-xl bg-red-900/20 border border-red-500/20 text-xs text-red-300">
              {error}
            </div>
          )}

          {/* Receipt viewer — works with Drive OR stored image in DB */}
          {expense.has_receipt && (
            <div className="mb-4 space-y-3">
              {/* Status bar */}
              {expense.drive_file_id ? (
                <div className="flex items-center justify-between p-2.5 rounded-xl bg-green-mid/10 border border-green-mid/20">
                  <span className="text-xs text-green-light">
                    Justificatif sur Drive
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
                      href={api.getReceiptUrl(expense.id)}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="px-3 py-1 rounded-lg bg-green-mid/20 text-xs text-green-light font-medium"
                    >
                      {'\u2B07'} T{'\u00E9'}l{'\u00E9'}charger
                    </a>
                  </div>
                </div>
              ) : expense.upload_status === 'exported' ? (
                <div className="flex items-center justify-between p-2.5 rounded-xl bg-blue-500/10 border border-blue-500/20">
                  <span className="text-xs text-blue-400">
                    Export{'\u00E9'} via ZIP
                  </span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setShowReceipt(!showReceipt)}
                      className="px-3 py-1 rounded-lg bg-blue-500/20 text-xs text-blue-400 font-medium"
                    >
                      {showReceipt ? 'Masquer' : 'Voir'}
                    </button>
                    <a
                      href={api.getReceiptUrl(expense.id)}
                      download={`justificatif-${expense.id}.jpg`}
                      onClick={(e) => e.stopPropagation()}
                      className="px-3 py-1 rounded-lg bg-blue-500/20 text-xs text-blue-400 font-medium"
                    >
                      {'\u2B07'} T{'\u00E9'}l{'\u00E9'}charger
                    </a>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20">
                  <span className="text-xs text-amber-400">
                    Drive {'\u00E9'}chou{'\u00E9'} — image sauvegard{'\u00E9'}e localement
                  </span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setShowReceipt(!showReceipt)}
                      className="px-3 py-1 rounded-lg bg-amber-500/20 text-xs text-amber-400 font-medium"
                    >
                      {showReceipt ? 'Masquer' : 'Voir'}
                    </button>
                    <a
                      href={api.getReceiptUrl(expense.id)}
                      download={`justificatif-${expense.id}.jpg`}
                      onClick={(e) => e.stopPropagation()}
                      className="px-3 py-1 rounded-lg bg-amber-500/20 text-xs text-amber-400 font-medium"
                    >
                      {'\u2B07'} T{'\u00E9'}l{'\u00E9'}charger
                    </a>
                  </div>
                </div>
              )}

              {/* Retry Drive upload button */}
              {!expense.drive_file_id && expense.upload_status === 'error' && (
                <button
                  type="button"
                  onClick={handleRetryDrive}
                  disabled={retrying}
                  className="w-full py-2 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs font-medium transition-transform active:scale-[0.97] disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {retrying ? (
                    <>
                      <span className="w-3.5 h-3.5 border-2 border-blue-400/30 border-t-blue-400 rounded-full animate-spin" />
                      Renvoi vers Drive...
                    </>
                  ) : (
                    <>Renvoyer vers Google Drive</>
                  )}
                </button>
              )}

              {showReceipt && (
                <div className="rounded-2xl overflow-hidden border border-card-border bg-white">
                  <img
                    src={api.getReceiptUrl(expense.id)}
                    alt="Justificatif"
                    className="w-full max-h-[300px] object-contain"
                    onError={(e) => {
                      // If image fails, try as iframe (PDF from Drive)
                      const parent = e.target.parentNode;
                      const iframe = document.createElement('iframe');
                      iframe.src = api.getReceiptUrl(expense.id);
                      iframe.className = 'w-full h-[250px] sm:h-[300px]';
                      iframe.title = 'Justificatif';
                      parent.replaceChild(iframe, e.target);
                    }}
                  />
                </div>
              )}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-3">
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
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
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
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
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
                    onClick={() => setType(t.value)}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                      type === t.value
                        ? 'bg-green-mid/20 border border-green-mid text-green-light'
                        : 'bg-card border border-card-border text-text-muted'
                    }`}
                  >
                    <TypeIcon icon={t.icon} color={t.color} size={14} /> {t.label}
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
                value={merchant}
                onChange={(e) => setMerchant(e.target.value)}
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
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={500}
                placeholder="Description courte"
                className="w-full bg-bg border border-card-border rounded-xl px-3 py-2.5 text-text text-sm focus:outline-none focus:border-green-mid"
              />
            </div>

            {/* Buttons */}
            <div className="flex gap-3 pt-1 pb-2">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 py-3 rounded-2xl bg-card border border-card-border text-text-muted font-medium text-sm transition-transform active:scale-[0.97]"
              >
                Annuler
              </button>
              <button
                type="submit"
                disabled={saving}
                className="flex-1 py-3 rounded-2xl text-white font-semibold text-sm transition-transform active:scale-[0.97] disabled:opacity-50 flex items-center justify-center gap-2"
                style={{
                  background: 'linear-gradient(135deg, #2D6A27, #4A9E40)',
                  boxShadow: '0 4px 20px rgba(77, 158, 64, 0.3)',
                }}
              >
                {saving ? (
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

          {/* Admin delete section */}
          {isAdmin && (
            <div className="mt-4 pt-4 border-t border-card-border">
              {!showDeleteConfirm ? (
                <button
                  type="button"
                  onClick={() => setShowDeleteConfirm(true)}
                  className="w-full py-2.5 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm font-medium transition-transform active:scale-[0.97]"
                >
                  Supprimer cette d{'\u00E9'}pense
                </button>
              ) : (
                <div className="space-y-3">
                  <p className="text-red-400/80 text-xs text-center">
                    Cette action est irr{'\u00E9'}versible. Le fichier Drive sera aussi supprim{'\u00E9'}.
                  </p>
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={() => setShowDeleteConfirm(false)}
                      className="flex-1 py-2.5 rounded-2xl bg-card border border-card-border text-text-muted font-medium text-sm transition-transform active:scale-[0.97]"
                    >
                      Annuler
                    </button>
                    <button
                      type="button"
                      onClick={handleDelete}
                      disabled={deleting}
                      className="flex-1 py-2.5 rounded-2xl bg-red-500/20 border border-red-500/30 text-red-400 font-medium text-sm transition-transform active:scale-[0.97] disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                      {deleting ? (
                        <>
                          <span className="w-4 h-4 border-2 border-red-400/30 border-t-red-400 rounded-full animate-spin" />
                          Suppression...
                        </>
                      ) : (
                        'Confirmer la suppression'
                      )}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
