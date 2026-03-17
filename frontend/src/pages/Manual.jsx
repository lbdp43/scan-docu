import React, { useState, useRef } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { api } from '../utils/api';
import { savePendingExpense } from '../utils/offline';
import { useExpenseTypes } from '../context/ExpenseTypesContext';
import Toast from '../components/Toast';
import TypeIcon from '../components/TypeIcon';
import CreateTypeInline from '../components/CreateTypeInline';

// Compress image client-side before uploading
function compressImage(file, maxWidth = 1400, quality = 0.75) {
  return new Promise((resolve) => {
    if (file.size < 300_000 || !file.type.startsWith('image/')) {
      return resolve(file);
    }
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let { width, height } = img;
      if (width > maxWidth) {
        height = Math.round((height * maxWidth) / width);
        width = maxWidth;
      }
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) => resolve(new File([blob], file.name, { type: 'image/jpeg' })),
        'image/jpeg',
        quality
      );
    };
    img.onerror = () => resolve(file);
    img.src = URL.createObjectURL(file);
  });
}

export default function Manual() {
  const navigate = useNavigate();
  const { isOnline, refreshPendingCount } = useOutletContext() || {};
  const { types: EXPENSE_TYPES } = useExpenseTypes();
  const fileInputRef = useRef(null);
  const [toast, setToast] = useState(null);
  const [loading, setLoading] = useState(false);

  const [amount, setAmount] = useState('');
  const [dateTicket, setDateTicket] = useState(new Date().toISOString().slice(0, 10));
  const [type, setType] = useState('autre');
  const [merchant, setMerchant] = useState('');
  const [description, setDescription] = useState('');
  const [showCreateType, setShowCreateType] = useState(false);

  // Optional photo
  const [photoFile, setPhotoFile] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);

  const handlePhotoSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setPhotoPreview(URL.createObjectURL(file));
    const compressed = await compressImage(file);
    setPhotoFile(compressed);
  };

  const removePhoto = () => {
    setPhotoFile(null);
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhotoPreview(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

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

    const expenseData = {
      amount,
      date_ticket: dateTicket,
      type,
      merchant: merchant.trim(),
      description: description.trim(),
    };

    // If offline, save to IndexedDB queue (with optional photo)
    if (!navigator.onLine) {
      try {
        await savePendingExpense(expenseData, photoFile);
        refreshPendingCount?.();
        setToast({ message: 'Sauvegardé hors ligne — sera envoyé au retour du réseau', type: 'warning' });
        setTimeout(() => navigate('/dashboard'), 2000);
      } catch (offlineErr) {
        setToast({ message: 'Erreur de sauvegarde hors ligne', type: 'error' });
        setLoading(false);
      }
      return;
    }

    try {
      const formData = new FormData();
      if (photoFile) formData.append('image', photoFile);
      formData.append('amount', amount);
      formData.append('date_ticket', dateTicket);
      formData.append('type', type);
      formData.append('merchant', merchant.trim());
      formData.append('description', description.trim());

      const result = await api.submitScan(formData);

      if (result.driveUrl) {
        setToast({ message: 'Dépense enregistrée et PDF envoyé sur Drive', type: 'success' });
      } else {
        setToast({ message: 'Dépense enregistrée', type: 'success' });
      }
      setTimeout(() => navigate('/dashboard'), 2000);
    } catch (err) {
      // If network error, try offline save (with optional photo)
      if (!navigator.onLine || err.message?.includes('fetch')) {
        try {
          await savePendingExpense(expenseData, photoFile);
          refreshPendingCount?.();
          setToast({ message: 'Connexion perdue — sauvegardé hors ligne', type: 'warning' });
          setTimeout(() => navigate('/dashboard'), 2000);
          return;
        } catch {}
      }
      setToast({ message: err.message || 'Erreur', type: 'error' });
      setLoading(false);
    }
  };

  const today = new Date().toISOString().slice(0, 10);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  return (
    <div className="space-y-6 animate-fade-up">
      {toast && <Toast {...toast} onClose={() => setToast(null)} />}

      <div>
        <h1 className="font-serif text-xl font-semibold">Saisie manuelle</h1>
        <p className="text-text-muted text-sm mt-1">Avec ou sans justificatif photo</p>
      </div>

      {!photoFile && (
        <div className="p-3 rounded-2xl bg-amber-900/20 border border-amber-500/20 text-xs text-amber-300">
          Sans photo, cette dépense sera marquée « Sans justificatif » dans le suivi admin.
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Optional Photo */}
        <div>
          <label className="block text-[10px] uppercase tracking-widest text-text-muted mb-2">
            Photo justificative (optionnel)
          </label>
          {photoPreview ? (
            <div className="relative">
              <img src={photoPreview} alt="Justificatif" className="w-full rounded-2xl max-h-48 object-cover" />
              <button
                type="button"
                onClick={removePhoto}
                className="absolute top-2 right-2 bg-black/70 rounded-full px-3 py-1 text-xs text-white"
              >
                Retirer
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="w-full border-2 border-dashed border-green-mid/25 rounded-2xl p-6 flex flex-col items-center gap-2 bg-green-mid/[0.03] transition-colors hover:bg-green-mid/[0.06] active:scale-[0.98]"
            >
              <span className="text-green-light/60">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="5" width="20" height="15" rx="3" /><circle cx="12" cy="13" r="4" /><path d="M8.5 5L9.5 3h5l1 2" /></svg>
              </span>
              <span className="text-text-muted text-xs">Ajouter une photo pour justifier</span>
            </button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            capture="environment"
            onChange={handlePhotoSelect}
            className="hidden"
          />
        </div>

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
                onClick={() => { setType(t.value); setShowCreateType(false); }}
                className={`px-4 py-2.5 rounded-full text-sm font-medium transition-all flex items-center gap-1.5 ${
                  type === t.value
                    ? 'bg-green-mid/20 border border-green-mid text-green-light'
                    : 'bg-card border border-card-border text-text-muted'
                }`}
              >
                <TypeIcon icon={t.icon} color={t.color} size={14} /> {t.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setShowCreateType(true)}
              className="px-4 py-2.5 rounded-full text-sm font-medium transition-all flex items-center gap-1.5 bg-card border border-dashed border-card-border text-text-muted hover:border-green-mid/40 hover:text-green-light"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg>
              Nouveau
            </button>
          </div>
          {showCreateType && (
            <CreateTypeInline
              onCreated={(newValue) => {
                setType(newValue);
                setShowCreateType(false);
                setToast({ message: 'Type cr\u00E9\u00E9', type: 'success' });
              }}
              onCancel={() => setShowCreateType(false)}
            />
          )}
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
            'Enregistrer et envoyer sur Drive'
          )}
        </button>
      </form>
    </div>
  );
}
