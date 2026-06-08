import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useNavigate, useOutletContext, useSearchParams } from 'react-router-dom';
import { api } from '../utils/api';
import { savePendingExpense } from '../utils/offline';
import { useExpenseTypes } from '../context/ExpenseTypesContext';
import Toast from '../components/Toast';
import TypeIcon from '../components/TypeIcon';
import CreateTypeInline from '../components/CreateTypeInline';
import DuplicateWarning from '../components/DuplicateWarning';
import { haptic } from '../utils/haptic';

// Compress image client-side — 1200px is enough for OCR + PDF
function compressImage(file, maxWidth = 1200, quality = 0.78) {
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
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
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

export default function Scan() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { isOnline, refreshPendingCount } = useOutletContext() || {};
  const { types: EXPENSE_TYPES } = useExpenseTypes();
  const fileInputRef = useRef(null);
  const amountRef = useRef(null);
  const autoScanTriggered = useRef(false);

  const [hasImage, setHasImage] = useState(false);
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  // 'idle' | 'running' | 'done' | 'failed'
  const [ocrState, setOcrState] = useState('idle');
  const [ocrConfidence, setOcrConfidence] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState(null);

  // Form fields — no type pre-selected, user must choose
  const [amount, setAmount] = useState('');
  const [dateTicket, setDateTicket] = useState('');
  const [type, setType] = useState('');
  const [merchant, setMerchant] = useState('');
  const [description, setDescription] = useState('');
  const [showCreateType, setShowCreateType] = useState(false);
  const [ocrSuggestedType, setOcrSuggestedType] = useState(null);
  const [duplicateFound, setDuplicateFound] = useState(null);
  const [skipDuplicateCheck, setSkipDuplicateCheck] = useState(false);

  // Track which fields the user has already manually edited
  // so OCR result doesn't overwrite user input
  const userEdited = useRef({ amount: false, merchant: false });

  // Auto-open camera when launched via PWA shortcut (?action=scan)
  useEffect(() => {
    if (searchParams.get('action') === 'scan' && !autoScanTriggered.current && !hasImage) {
      autoScanTriggered.current = true;
      setSearchParams({}, { replace: true });
      setTimeout(() => fileInputRef.current?.click(), 300);
    }
  }, [searchParams]);

  const handleCapture = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    haptic('medium');

    // 1. Show preview + form IMMEDIATELY (no waiting)
    setImagePreview(URL.createObjectURL(file));
    setHasImage(true);
    setDateTicket(new Date().toISOString().slice(0, 10));
    setAmount('');
    setMerchant('');
    setDescription('');
    setType('');
    setOcrSuggestedType(null);
    userEdited.current = { amount: false, merchant: false };
    setOcrState('running');
    setOcrConfidence(null);

    // 2. Focus amount field for quick entry while OCR runs
    setTimeout(() => amountRef.current?.focus(), 80);

    // 3. Compress (client-side, works offline)
    const compressed = await compressImage(file);
    setImageFile(compressed);

    // 4. OCR in background — if offline or error, user already has the form
    if (!navigator.onLine) {
      setOcrState('failed');
      return;
    }

    try {
      const formData = new FormData();
      formData.append('image', compressed);
      const result = await api.scanImage(formData);

      setOcrConfidence(result.confidence);

      // Update fields only if user hasn't already typed something
      if (result.extracted) {
        if (result.extracted.amount && !userEdited.current.amount) {
          setAmount(String(result.extracted.amount));
        }
        if (result.extracted.date) {
          setDateTicket(result.extracted.date);
        }
        // Type is NEVER auto-selected — shown as a suggestion only
        if (result.extracted.type && result.extracted.type !== 'autre') {
          setOcrSuggestedType(result.extracted.type);
        }
        if (result.extracted.merchant && !userEdited.current.merchant) {
          setMerchant(result.extracted.merchant);
        }
        if (result.extracted.description && !userEdited.current.merchant) {
          setDescription(result.extracted.description || '');
        }
      }
      setOcrState('done');
    } catch {
      setOcrState('failed');
    }
  }, []);

  const doSubmit = async () => {
    setSubmitting(true);
    const date = dateTicket || new Date().toISOString().slice(0, 10);

    if (!navigator.onLine) {
      try {
        await savePendingExpense({ amount, date_ticket: date, type, merchant, description }, imageFile);
        refreshPendingCount?.();
        setToast({ message: 'Sauvegardé hors ligne — sera envoyé au retour du réseau', type: 'warning' });
        setTimeout(() => navigate('/dashboard', { viewTransition: true }), 1800);
      } catch {
        setToast({ message: 'Erreur de sauvegarde hors ligne', type: 'error' });
        setSubmitting(false);
      }
      return;
    }

    try {
      const formData = new FormData();
      if (imageFile) formData.append('image', imageFile);
      formData.append('amount', amount);
      formData.append('date_ticket', date);
      formData.append('type', type);
      formData.append('merchant', merchant);
      formData.append('description', description);

      const result = await api.submitScan(formData);

      if (result.uploadStatus === 'error') {
        setToast({
          message: 'Dépense enregistrée, mais l\'envoi Drive a échoué (token expiré ?)',
          type: 'warning',
        });
      } else {
        haptic('success');
        setToast({
          message: result.driveUrl ? 'Ticket envoyé dans Google Drive ✓' : 'Dépense enregistrée',
          type: 'success',
        });
      }
      setTimeout(() => navigate('/dashboard', { viewTransition: true }), 1800);
    } catch (err) {
      if (!navigator.onLine || err.message?.includes('fetch')) {
        try {
          await savePendingExpense({ amount, date_ticket: date, type, merchant, description }, imageFile);
          refreshPendingCount?.();
          setToast({ message: 'Connexion perdue — sauvegardé hors ligne', type: 'warning' });
          setTimeout(() => navigate('/dashboard', { viewTransition: true }), 1800);
          return;
        } catch {}
      }
      setToast({ message: err.message || 'Erreur lors de l\'envoi', type: 'error' });
      setSubmitting(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!amount || parseFloat(amount) <= 0) {
      haptic('error');
      setToast({ message: 'Montant requis', type: 'error' });
      return;
    }
    if (!type) {
      haptic('error');
      setToast({ message: 'Veuillez sélectionner un type de dépense', type: 'error' });
      return;
    }

    if (!skipDuplicateCheck && navigator.onLine) {
      try {
        const date = dateTicket || new Date().toISOString().slice(0, 10);
        const { duplicate } = await api.checkDuplicate({ amount, date_ticket: date, merchant });
        if (duplicate) {
          haptic('medium');
          setDuplicateFound(duplicate);
          return;
        }
      } catch {}
    }

    setSkipDuplicateCheck(false);
    await doSubmit();
  };

  const reset = () => {
    setHasImage(false);
    setImageFile(null);
    if (imagePreview) URL.revokeObjectURL(imagePreview);
    setImagePreview(null);
    setOcrState('idle');
    setOcrConfidence(null);
    setAmount('');
    setDateTicket('');
    setType('');
    setOcrSuggestedType(null);
    setMerchant('');
    setDescription('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // ── Capture screen ──────────────────────────────────────────
  if (!hasImage) {
    return (
      <div className="flex flex-col min-h-[calc(100vh-180px)]">
        {toast && <Toast {...toast} onClose={() => setToast(null)} />}

        <h1 className="font-serif text-xl font-semibold">Scanner un ticket</h1>

        {/* Big capture button — centered vertically */}
        <div className="flex-1 flex items-center justify-center py-8">
        <button
          onClick={() => fileInputRef.current?.click()}
          className="w-full border border-green-mid/25 rounded-3xl p-12 flex flex-col items-center gap-5 bg-green-mid/[0.04] transition-all hover:bg-green-mid/[0.08] hover:border-green-mid/40 active:scale-[0.98]"
        >
          <div className="w-16 h-16 rounded-2xl bg-green-mid/10 flex items-center justify-center">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-green-light">
              <rect x="2" y="5" width="20" height="15" rx="3" />
              <circle cx="12" cy="13" r="4" />
              <path d="M8.5 5L9.5 3h5l1 2" />
            </svg>
          </div>
          <div className="text-center">
            <p className="text-text font-semibold text-base">Prendre une photo</p>
            <p className="text-text-muted text-sm mt-1">ou choisir depuis la galerie</p>
          </div>
        </button>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,application/pdf"
          capture="environment"
          onChange={handleCapture}
          className="hidden"
        />

        <div className="p-4 rounded-2xl bg-card border border-card-border">
          <p className="text-text-muted text-xs leading-relaxed">
            <strong className="text-text">Conseil :</strong> Ticket {'\u00E0'} plat, bonne lumi{'\u00E8'}re. L'OCR s'analyse en arri{'\u00E8'}re-plan — vous pouvez saisir le montant pendant ce temps.
          </p>
        </div>
      </div>
    );
  }

  // ── Form (shown immediately after photo) ─────────────────────
  return (
    <div className="space-y-5">
      {toast && <Toast {...toast} onClose={() => setToast(null)} />}

      {/* Image preview + OCR status bar */}
      <div className="relative">
        <img
          src={imagePreview}
          alt="Ticket"
          className="w-full rounded-2xl max-h-52 object-cover"
        />
        {/* OCR status overlay */}
        <div className={`absolute bottom-2 left-2 right-2 flex items-center justify-between px-3 py-1.5 rounded-xl text-xs font-medium backdrop-blur-sm transition-all ${
          ocrState === 'running'
            ? 'bg-amber-900/80 text-amber-200'
            : ocrState === 'done'
            ? 'bg-green-mid/80 text-white'
            : ocrState === 'failed'
            ? 'bg-black/70 text-text-muted'
            : ''
        }`}>
          {ocrState === 'running' && (
            <>
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 border-2 border-amber-300/40 border-t-amber-200 rounded-full animate-spin shrink-0" />
                Analyse OCR en cours…
              </span>
              <span className="text-amber-300/70">Saisissez le montant maintenant</span>
            </>
          )}
          {ocrState === 'done' && (
            <span>
              ✓ OCR terminé
              {ocrConfidence != null && ` — confiance ${Math.round(ocrConfidence)}%`}
            </span>
          )}
          {ocrState === 'failed' && (
            <span>OCR non disponible — saisie manuelle</span>
          )}
        </div>
        <button
          onClick={reset}
          className="absolute top-2 right-2 bg-black/70 rounded-full px-3 py-1 text-xs text-white"
        >
          Reprendre
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Amount — big and first, focused immediately */}
        <div>
          <label className="block text-[10px] uppercase tracking-widest text-text-muted mb-2">
            Montant (€) *
          </label>
          <input
            ref={amountRef}
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0.01"
            max="9999.99"
            value={amount}
            onChange={(e) => { setAmount(e.target.value); userEdited.current.amount = true; }}
            required
            placeholder="0.00"
            className="w-full bg-card border border-card-border rounded-2xl px-5 py-4 text-text text-2xl font-serif focus:outline-none focus:border-green-mid"
          />
        </div>

        {/* Date */}
        <div>
          <label className="block text-[10px] uppercase tracking-widest text-text-muted mb-2">
            Date du ticket
          </label>
          <input
            type="date"
            value={dateTicket}
            onChange={(e) => setDateTicket(e.target.value)}
            max={new Date().toISOString().slice(0, 10)}
            className="w-full bg-card border border-card-border rounded-2xl px-5 py-4 text-text focus:outline-none focus:border-green-mid [color-scheme:dark]"
          />
        </div>

        {/* Type pills */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="block text-[10px] uppercase tracking-widest text-text-muted">
              Type de dépense <span className="text-red-400">*</span>
            </label>
            {ocrSuggestedType && !type && (
              <span className="text-[10px] text-amber-300/80">
                OCR suggère :&nbsp;
                <button
                  type="button"
                  onClick={() => setType(ocrSuggestedType)}
                  className="underline font-medium text-amber-300"
                >
                  {EXPENSE_TYPES.find(t => t.value === ocrSuggestedType)?.label}
                </button>
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {EXPENSE_TYPES.map(t => (
              <button
                key={t.value}
                type="button"
                onClick={() => { haptic('light'); setType(t.value); setShowCreateType(false); }}
                className={`px-4 py-2.5 rounded-2xl text-sm font-medium transition-all flex items-center gap-1.5 ${
                  type === t.value
                    ? 'bg-green-mid/20 border-2 border-green-mid text-green-light'
                    : ocrSuggestedType === t.value && !type
                    ? 'bg-amber-900/20 border border-amber-500/40 text-amber-300/80'
                    : 'bg-card border border-card-border text-text-muted'
                }`}
              >
                <span style={{ color: t.color || '#6B7280' }}><TypeIcon icon={t.icon} color={t.color} size={18} /></span>
                <span className="text-xs">{t.label}</span>
              </button>
            ))}
            <button
              type="button"
              onClick={() => setShowCreateType(true)}
              className="px-4 py-2.5 rounded-2xl text-sm font-medium transition-all flex items-center gap-1.5 bg-card border border-dashed border-card-border text-text-muted hover:border-green-mid/40 hover:text-green-light"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg>
              <span className="text-xs">Nouveau</span>
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
          {!type && !showCreateType && (
            <p className="text-[10px] text-text-dim mt-1.5">S{'\u00E9'}lectionnez le type avant d'envoyer</p>
          )}
        </div>

        {/* Merchant + Description (optional, collapsible label) */}
        <div>
          <label className="block text-[10px] uppercase tracking-widest text-text-muted mb-2">
            Commerçant <span className="normal-case text-text-dim">(optionnel)</span>
          </label>
          <input
            type="text"
            value={merchant}
            onChange={(e) => { setMerchant(e.target.value); userEdited.current.merchant = true; }}
            maxLength={255}
            placeholder="Ex: VINCI Autoroutes A71"
            className="w-full bg-card border border-card-border rounded-2xl px-5 py-3.5 text-text text-sm focus:outline-none focus:border-green-mid"
          />
        </div>

        <div>
          <label className="block text-[10px] uppercase tracking-widest text-text-muted mb-2">
            Description <span className="normal-case text-text-dim">(optionnel)</span>
          </label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={500}
            placeholder="Ex: Trajet Lyon → Paris"
            className="w-full bg-card border border-card-border rounded-2xl px-5 py-3.5 text-text text-sm focus:outline-none focus:border-green-mid"
          />
        </div>

        {/* Submit */}
        <button
          type="submit"
          disabled={submitting}
          className="w-full py-5 rounded-3xl text-white font-semibold text-base transition-transform active:scale-[0.97] disabled:opacity-60 flex items-center justify-center gap-3"
          style={{
            background: 'linear-gradient(135deg, #2D6A27, #4A9E40)',
            boxShadow: '0 4px 20px rgba(77, 158, 64, 0.3)',
          }}
        >
          {submitting ? (
            <>
              <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Envoi en cours…
            </>
          ) : (
            <>Enregistrer la d{'\u00E9'}pense</>
          )}
        </button>
      </form>

      <DuplicateWarning
        duplicate={duplicateFound}
        loading={submitting}
        onCancel={() => setDuplicateFound(null)}
        onConfirm={() => {
          setDuplicateFound(null);
          setSkipDuplicateCheck(true);
          doSubmit();
        }}
      />
    </div>
  );
}
