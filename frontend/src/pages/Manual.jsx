import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../utils/api';
import Toast from '../components/Toast';

const EXPENSE_TYPES = [
  { value: 'carburant', label: 'Carburant', icon: '⛽' },
  { value: 'repas', label: 'Repas', icon: '🍽️' },
  { value: 'peage', label: 'Péage', icon: '🛣️' },
  { value: 'autre', label: 'Autre', icon: '📄' },
];

export default function Manual() {
  const navigate = useNavigate();
  const [toast, setToast] = useState(null);
  const [loading, setLoading] = useState(false);

  const [amount, setAmount] = useState('');
  const [dateTicket, setDateTicket] = useState(new Date().toISOString().slice(0, 10));
  const [type, setType] = useState('autre');
  const [merchant, setMerchant] = useState('');
  const [description, setDescription] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!amount || parseFloat(amount) <= 0) {
      setToast({ message: 'Montant requis', type: 'error' });
      return;
    }
    if (!merchant.trim()) {
      setToast({ message: 'Commerçant requis', type: 'error' });
      return;
    }
    if (!description.trim()) {
      setToast({ message: 'Motif / description requis', type: 'error' });
      return;
    }

    setLoading(true);

    try {
      await api.createExpense({
        date_ticket: dateTicket,
        amount: parseFloat(amount),
        type,
        merchant: merchant.trim(),
        description: description.trim(),
        has_receipt: false,
        upload_status: 'uploaded', // No Drive upload needed for manual
      });

      setToast({ message: 'Dépense enregistrée', type: 'success' });
      setTimeout(() => navigate('/'), 2000);
    } catch (err) {
      setToast({ message: err.message || 'Erreur', type: 'error' });
      setLoading(false);
    }
  };

  // Calculate max date (today) and min date (30 days ago)
  const today = new Date().toISOString().slice(0, 10);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  return (
    <div className="space-y-6 animate-fade-up">
      {toast && <Toast {...toast} onClose={() => setToast(null)} />}

      <div>
        <h1 className="font-serif text-xl font-semibold">Saisie sans ticket</h1>
        <p className="text-text-muted text-sm mt-1">Dépense sans justificatif</p>
      </div>

      <div className="p-3 rounded-2xl bg-amber-900/20 border border-amber-500/20 text-xs text-amber-300">
        ⚠️ Cette dépense sera marquée « Sans justificatif » dans le suivi admin.
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Amount */}
        <div>
          <label className="block text-[10px] uppercase tracking-widest text-text-muted mb-2">
            Montant (€) *
          </label>
          <input
            type="number"
            step="0.01"
            min="0.01"
            max="999.99"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
            placeholder="0.00"
            className="w-full bg-card border border-card-border rounded-2xl px-5 py-4 text-text text-lg font-serif focus:outline-none focus:border-green-mid"
          />
        </div>

        {/* Date */}
        <div>
          <label className="block text-[10px] uppercase tracking-widest text-text-muted mb-2">
            Date *
          </label>
          <input
            type="date"
            value={dateTicket}
            onChange={(e) => setDateTicket(e.target.value)}
            min={thirtyDaysAgo}
            max={today}
            required
            className="w-full bg-card border border-card-border rounded-2xl px-5 py-4 text-text focus:outline-none focus:border-green-mid [color-scheme:dark]"
          />
        </div>

        {/* Type pills */}
        <div>
          <label className="block text-[10px] uppercase tracking-widest text-text-muted mb-2">
            Type de dépense *
          </label>
          <div className="flex gap-2 flex-wrap">
            {EXPENSE_TYPES.map(t => (
              <button
                key={t.value}
                type="button"
                onClick={() => setType(t.value)}
                className={`px-4 py-2.5 rounded-full text-sm font-medium transition-all ${
                  type === t.value
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
          <label className="block text-[10px] uppercase tracking-widest text-text-muted mb-2">
            Commerçant / Lieu *
          </label>
          <input
            type="text"
            value={merchant}
            onChange={(e) => setMerchant(e.target.value)}
            maxLength={100}
            required
            placeholder="Ex: Station Total A47"
            className="w-full bg-card border border-card-border rounded-2xl px-5 py-4 text-text focus:outline-none focus:border-green-mid"
          />
        </div>

        {/* Description / Motif */}
        <div>
          <label className="block text-[10px] uppercase tracking-widest text-text-muted mb-2">
            Motif / Description *
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={200}
            required
            rows={2}
            placeholder="Ex: Café client RDV Lyon"
            className="w-full bg-card border border-card-border rounded-2xl px-5 py-4 text-text focus:outline-none focus:border-green-mid resize-none"
          />
          <p className="text-text-dim text-[10px] mt-1 text-right">{description.length}/200</p>
        </div>

        {/* Submit */}
        <button
          type="submit"
          disabled={loading}
          className="w-full py-5 rounded-3xl text-white font-semibold text-base transition-transform active:scale-[0.97] disabled:opacity-50 flex items-center justify-center gap-3"
          style={{
            background: 'linear-gradient(135deg, #2D6A27, #4A9E40)',
            boxShadow: '0 4px 20px rgba(77, 158, 64, 0.3)',
          }}
        >
          {loading ? (
            <>
              <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Envoi…
            </>
          ) : (
            'Enregistrer la dépense'
          )}
        </button>
      </form>
    </div>
  );
}
