import React, { useState, useRef, useCallback } from 'react';
import { useNavigate, useOutletContext, useSearchParams, Link } from 'react-router-dom';
import { api } from '../utils/api';
import { savePendingExpense } from '../utils/offline';
import { PAYMENT_OPTIONS, REIMBURSABLE_METHODS } from '../utils/payment';
import { useExpenseTypes } from '../context/ExpenseTypesContext';
import Toast from '../components/Toast';
import TypeIcon from '../components/TypeIcon';
import CreateTypeInline from '../components/CreateTypeInline';
import DuplicateWarning from '../components/DuplicateWarning';
import { haptic } from '../utils/haptic';

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
  const { isOnline, refreshPendingCount } = useOutletContext() || {};
  const { types: EXPENSE_TYPES } = useExpenseTypes();
  const fileInputRef = useRef(null);
  const addPhotoInputRef = useRef(null);
  const amountRef = useRef(null);

  // Justification d'un paiement précis (lien depuis "à justifier") : montant + date imposés
  const [searchParams] = useSearchParams();
  const targetAmount = searchParams.get('amount') || '';
  const targetDate = searchParams.get('date') || '';
  const targetMerchant = searchParams.get('merchant') || '';
  const fromMissing = Boolean(targetAmount || targetDate);

  const [hasImage, setHasImage] = useState(false);
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  // Pages supplémentaires (2ᵉ, 3ᵉ photo…) pour un même justificatif -> PDF multi-pages
  const [extraPhotos, setExtraPhotos] = useState([]);
  const [ocrState, setOcrState] = useState('idle');
  const [ocrConfidence, setOcrConfidence] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState(null);

  const [amount, setAmount] = useState(targetAmount);
  const [dateTicket, setDateTicket] = useState(targetDate);
  const [type, setType] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('carte');
  const [merchant, setMerchant] = useState(targetMerchant.slice(0, 255));
  const [description, setDescription] = useState('');
  const [showCreateType, setShowCreateType] = useState(false);
  const [ocrSuggestedType, setOcrSuggestedType] = useState(null);
  const [duplicateFound, setDuplicateFound] = useState(null);
  const [skipDuplicateCheck, setSkipDuplicateCheck] = useState(false);
  const [scanCount, setScanCount] = useState(0);
  const [lastResult, setLastResult] = useState(null);

  const userEdited = useRef({ amount: false, merchant: false });

  const handleCapture = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    haptic('medium');
    setLastResult(null);
    setImagePreview(URL.createObjectURL(file));
    setHasImage(true);
    // Si on justifie un paiement précis, on garde son montant + sa date (la photo = le justificatif)
    setDateTicket(fromMissing && targetDate ? targetDate : new Date().toISOString().slice(0, 10));
    setAmount(fromMissing ? targetAmount : '');
    setMerchant(fromMissing ? targetMerchant.slice(0, 255) : '');
    setDescription('');
    setType('');
    setOcrSuggestedType(null);
    userEdited.current = { amount: Boolean(fromMissing && targetAmount), merchant: false };
    setOcrState('running');
    setOcrConfidence(null);

    setTimeout(() => amountRef.current?.focus(), 80);

    const compressed = await compressImage(file);
    setImageFile(compressed);

    if (!navigator.onLine) {
      setOcrState('failed');
      return;
    }

    try {
      const formData = new FormData();
      formData.append('image', compressed);
      const result = await api.scanImage(formData);

      setOcrConfidence(result.confidence);

      if (result.extracted) {
        if (result.extracted.amount && !userEdited.current.amount) {
          setAmount(String(result.extracted.amount));
        }
        // Ne PAS écraser la date si on justifie un paiement précis (date imposée par la transaction)
        if (result.extracted.date && !fromMissing) {
          setDateTicket(result.extracted.date);
        }
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
  }, [fromMissing, targetAmount, targetDate, targetMerchant]);

  // Ajoute une page supplémentaire au justificatif en cours (pas d'OCR, champs conservés)
  const handleAddPhoto = async (e) => {
    const file = e.target.files?.[0];
    if (e.target) e.target.value = '';
    if (!file) return;
    haptic('light');
    const compressed = await compressImage(file);
    setExtraPhotos((prev) => [...prev, { file: compressed, url: URL.createObjectURL(compressed) }]);
  };

  const removeExtraPhoto = (idx) => {
    setExtraPhotos((prev) => {
      const next = [...prev];
      const [removed] = next.splice(idx, 1);
      if (removed?.url) URL.revokeObjectURL(removed.url);
      return next;
    });
  };

  const doSubmit = async () => {
    setSubmitting(true);
    const date = dateTicket || new Date().toISOString().slice(0, 10);

    if (!navigator.onLine) {
      try {
        await savePendingExpense({ amount, date_ticket: date, type, merchant, description }, imageFile);
        refreshPendingCount?.();
        haptic('success');
        setScanCount(c => c + 1);
        setLastResult({ success: true, message: 'Sauvegardé hors ligne' });
        setSubmitting(false);
      } catch {
        setToast({ message: 'Erreur de sauvegarde hors ligne', type: 'error' });
        setSubmitting(false);
      }
      return;
    }

    try {
      const formData = new FormData();
      // Page 1 puis pages supplémentaires -> justificatif PDF multi-pages
      if (imageFile) formData.append('image', imageFile);
      for (const p of extraPhotos) formData.append('image', p.file);
      formData.append('amount', amount);
      formData.append('date_ticket', date);
      formData.append('type', type);
      formData.append('payment_method', paymentMethod);
      formData.append('merchant', merchant);
      formData.append('description', description);

      const result = await api.submitScan(formData);

      haptic('success');
      setScanCount(c => c + 1);

      if (result.uploadStatus === 'error') {
        setLastResult({ success: true, message: 'Enregistré (Drive échoué)' });
      } else {
        setLastResult({
          success: true,
          message: result.driveUrl ? 'Envoyé sur Google Drive' : 'Dépense enregistrée',
        });
      }
      setSubmitting(false);
    } catch (err) {
      if (!navigator.onLine || err.message?.includes('fetch')) {
        try {
          await savePendingExpense({ amount, date_ticket: date, type, payment_method: paymentMethod, merchant, description }, imageFile);
          refreshPendingCount?.();
          haptic('success');
          setScanCount(c => c + 1);
          setLastResult({ success: true, message: 'Connexion perdue — sauvegardé hors ligne' });
          setSubmitting(false);
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
    extraPhotos.forEach((p) => p.url && URL.revokeObjectURL(p.url));
    setExtraPhotos([]);
    setOcrState('idle');
    setOcrConfidence(null);
    setAmount('');
    setDateTicket('');
    setType('');
    setOcrSuggestedType(null);
    setMerchant('');
    setDescription('');
    setLastResult(null);
    setSkipDuplicateCheck(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const scanAnother = () => {
    reset();
    setTimeout(() => fileInputRef.current?.click(), 200);
  };

  // ── Hidden file input (shared across all screens) ────────────
  const fileInput = (
    <input
      ref={fileInputRef}
      type="file"
      accept="image/jpeg,image/png,image/webp,application/pdf"
      capture="environment"
      onChange={handleCapture}
      className="hidden"
    />
  );

  // Input dédié à l'ajout d'une page supplémentaire (ne réinitialise pas le formulaire)
  const addPhotoInput = (
    <input
      ref={addPhotoInputRef}
      type="file"
      accept="image/jpeg,image/png,image/webp"
      capture="environment"
      onChange={handleAddPhoto}
      className="hidden"
    />
  );

  // ── Success screen (multi-scan) ──────────────────────────────
  if (lastResult) {
    return (
      <div className="flex flex-col min-h-[calc(100vh-180px)]">
        {toast && <Toast {...toast} onClose={() => setToast(null)} />}
        {fileInput}

        <div className="flex-1 flex flex-col items-center justify-center py-8 gap-6">
          <div className="w-20 h-20 rounded-full bg-green-mid/20 flex items-center justify-center">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-green-light">
              <path d="M20 6L9 17l-5-5" />
            </svg>
          </div>

          <div className="text-center">
            <p className="text-white font-semibold text-lg">{lastResult.message}</p>
            <p className="text-text-muted text-sm mt-2">
              {scanCount} ticket{scanCount > 1 ? 's' : ''} scann{'é'}{scanCount > 1 ? 's' : ''} dans cette session
            </p>
          </div>

          <div className="w-full space-y-3 mt-4">
            <button
              onClick={scanAnother}
              className="w-full py-5 rounded-3xl text-white font-semibold text-base transition-transform active:scale-[0.97] flex items-center justify-center gap-3"
              style={{
                background: 'linear-gradient(135deg, #2D6A27, #4A9E40)',
                boxShadow: '0 4px 20px rgba(77, 158, 64, 0.3)',
              }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="5" width="20" height="15" rx="3" />
                <circle cx="12" cy="13" r="4" />
                <path d="M8.5 5L9.5 3h5l1 2" />
              </svg>
              Scanner un autre ticket
            </button>

            <button
              onClick={() => navigate('/dashboard', { viewTransition: true })}
              className="w-full py-4 rounded-3xl border border-card-border text-text-muted font-medium text-sm transition-transform active:scale-[0.97]"
            >
              Terminer ({scanCount} ticket{scanCount > 1 ? 's' : ''})
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Capture screen ──────────────────────────────────────────
  if (!hasImage) {
    return (
      <div className="flex flex-col min-h-[calc(100vh-180px)]">
        {toast && <Toast {...toast} onClose={() => setToast(null)} />}

        <div className="flex items-center justify-between">
          <h1 className="font-serif text-xl font-semibold">Scanner un ticket</h1>
          {scanCount > 0 && (
            <span className="px-2.5 py-1 rounded-full bg-green-mid/20 text-green-light text-xs font-semibold">
              {scanCount} scann{'é'}{scanCount > 1 ? 's' : ''}
            </span>
          )}
        </div>

        {fromMissing && (
          <div className="mt-3 p-3 rounded-2xl bg-green-mid/10 border border-green-mid/30 text-xs text-green-light">
            {'📎'} Justificatif d'un paiement carte{targetAmount ? ` de ${Number(targetAmount).toFixed(2)} €` : ''}{targetDate ? ` du ${new Date(targetDate).toLocaleDateString('fr-FR')}` : ''}. Montant et date verrouillés — prends juste la photo.
          </div>
        )}

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
              <p className="text-text font-semibold text-base">
                {scanCount > 0 ? 'Scanner le ticket suivant' : 'Prendre une photo'}
              </p>
              <p className="text-text-muted text-sm mt-1">ou choisir depuis la galerie</p>
            </div>
          </button>
        </div>

        {fileInput}

        <Link viewTransition
          to="/manual"
          className="flex items-center gap-4 w-full p-4 rounded-3xl border border-green-mid/30 bg-card transition-transform active:scale-[0.97] mb-3"
        >
          <div className="w-12 h-12 rounded-2xl bg-green-mid/10 flex items-center justify-center text-green-light shrink-0">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
          </div>
          <div className="flex-1">
            <p className="text-text font-semibold text-base">Saisie sans ticket</p>
            <p className="text-text-muted text-xs mt-0.5">Saisie manuelle rapide</p>
          </div>
          <span className="text-text-dim text-xl">{'›'}</span>
        </Link>

        {scanCount === 0 ? (
          <div className="p-4 rounded-2xl bg-card border border-card-border">
            <p className="text-text-muted text-xs leading-relaxed">
              <strong className="text-text">Conseil :</strong> Ticket {'à'} plat, bonne lumi{'è'}re. L'OCR s'analyse en arri{'è'}re-plan {'—'} vous pouvez saisir le montant pendant ce temps.
            </p>
          </div>
        ) : (
          <button
            onClick={() => navigate('/dashboard', { viewTransition: true })}
            className="w-full py-4 rounded-3xl border border-card-border text-text-muted font-medium text-sm transition-transform active:scale-[0.97]"
          >
            Terminer ({scanCount} ticket{scanCount > 1 ? 's' : ''})
          </button>
        )}
      </div>
    );
  }

  // ── Form (shown immediately after photo) ─────────────────────
  return (
    <div className="space-y-5">
      {toast && <Toast {...toast} onClose={() => setToast(null)} />}
      {fileInput}

      {fromMissing && (
        <div className="p-3 rounded-2xl bg-green-mid/10 border border-green-mid/30 text-xs text-green-light">
          {'📎'} Justificatif d'un paiement de {targetAmount ? `${Number(targetAmount).toFixed(2)} €` : ''}{targetDate ? ` du ${new Date(targetDate).toLocaleDateString('fr-FR')}` : ''} — vérifie le type puis enregistre.
        </div>
      )}

      {/* Scan count badge */}
      {scanCount > 0 && (
        <div className="flex justify-end">
          <span className="px-2.5 py-1 rounded-full bg-green-mid/20 text-green-light text-xs font-semibold">
            {scanCount} scann{'é'}{scanCount > 1 ? 's' : ''}
          </span>
        </div>
      )}

      {/* Image preview + OCR status bar */}
      <div className="relative">
        <img
          src={imagePreview}
          alt="Ticket"
          className="w-full rounded-2xl max-h-52 object-cover"
        />
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
                Analyse OCR en cours{'…'}
              </span>
              <span className="text-amber-300/70">Saisissez le montant maintenant</span>
            </>
          )}
          {ocrState === 'done' && (
            <span>
              {'✓'} OCR termin{'é'}
              {ocrConfidence != null && ` — confiance ${Math.round(ocrConfidence)}%`}
            </span>
          )}
          {ocrState === 'failed' && (
            <span>OCR non disponible {'—'} saisie manuelle</span>
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
        <div>
          <label className="block text-[10px] uppercase tracking-widest text-text-muted mb-2">
            Montant ({'€'}) *
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

        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="block text-[10px] uppercase tracking-widest text-text-muted">
              Type de d{'é'}pense <span className="text-red-400">*</span>
            </label>
            {ocrSuggestedType && !type && (
              <span className="text-[10px] text-amber-300/80">
                OCR sugg{'è'}re :&nbsp;
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
                setToast({ message: 'Type créé', type: 'success' });
              }}
              onCancel={() => setShowCreateType(false)}
            />
          )}
          {!type && !showCreateType && (
            <p className="text-[10px] text-text-dim mt-1.5">S{'é'}lectionnez le type avant d'envoyer</p>
          )}
        </div>

        <div>
          <label className="block text-[10px] uppercase tracking-widest text-text-muted mb-2">
            Mode de paiement
          </label>
          <div className="flex flex-wrap gap-2">
            {PAYMENT_OPTIONS.map(opt => (
              <button
                key={opt.value}
                type="button"
                onClick={() => { haptic('light'); setPaymentMethod(opt.value); }}
                className={`px-4 py-2.5 rounded-2xl text-xs font-medium transition-all ${
                  paymentMethod === opt.value
                    ? 'bg-green-mid/20 border-2 border-green-mid text-green-light'
                    : 'bg-card border border-card-border text-text-muted'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          {REIMBURSABLE_METHODS.includes(paymentMethod) && (
            <p className="text-[10px] text-amber-300/90 mt-1.5">
              Une demande de remboursement sera envoy{'é'}e aux administrateurs
            </p>
          )}
        </div>

        <div>
          <label className="block text-[10px] uppercase tracking-widest text-text-muted mb-2">
            Commer{'ç'}ant <span className="normal-case text-text-dim">(optionnel)</span>
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

        {/* Pages du justificatif (photos multiples pour une seule facture) */}
        <div>
          <label className="block text-[10px] uppercase tracking-widest text-text-muted mb-2">
            Pages du justificatif
          </label>
          <div className="flex flex-wrap gap-2">
            {imagePreview && (
              <div className="relative w-16 h-16 rounded-xl overflow-hidden border border-card-border">
                <img src={imagePreview} alt="Page 1" className="w-full h-full object-cover" />
                <span className="absolute bottom-0 inset-x-0 bg-black/60 text-white text-[11px] text-center">1</span>
              </div>
            )}
            {extraPhotos.map((p, i) => (
              <div key={i} className="relative w-16 h-16 rounded-xl overflow-hidden border border-card-border">
                <img src={p.url} alt={`Page ${i + 2}`} className="w-full h-full object-cover" />
                <span className="absolute bottom-0 inset-x-0 bg-black/60 text-white text-[11px] text-center">{i + 2}</span>
                <button
                  type="button"
                  onClick={() => removeExtraPhoto(i)}
                  className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-black/70 text-white text-xs leading-none flex items-center justify-center"
                  aria-label="Retirer"
                >
                  {'×'}
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => addPhotoInputRef.current?.click()}
              className="w-16 h-16 rounded-xl border border-dashed border-green-mid/40 flex flex-col items-center justify-center text-green-light gap-1 active:scale-95 transition-transform"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg>
              <span className="text-[11px] leading-none">Photo</span>
            </button>
          </div>
          <p className="text-[10px] text-text-dim mt-1.5">
            Ajoute d'autres photos pour regrouper plusieurs pages dans un seul justificatif.
          </p>
        </div>

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
              Envoi en cours{'…'}
            </>
          ) : (
            <>Enregistrer la d{'é'}pense{extraPhotos.length > 0 ? ` (${extraPhotos.length + 1} pages)` : ''}</>
          )}
        </button>
        {addPhotoInput}
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
