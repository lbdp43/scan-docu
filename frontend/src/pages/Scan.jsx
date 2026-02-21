import React, { useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../utils/api';
import Toast from '../components/Toast';

const EXPENSE_TYPES = [
  { value: 'carburant', label: 'Carburant', icon: '⛽' },
  { value: 'repas', label: 'Repas', icon: '🍽️' },
  { value: 'peage', label: 'Péage', icon: '🛣️' },
  { value: 'autre', label: 'Autre', icon: '📄' },
];

// Compress image client-side before uploading (critical for mobile)
function compressImage(file, maxWidth = 1800, quality = 0.82) {
  return new Promise((resolve) => {
    // If file is small enough or not an image, send as-is
    if (file.size < 500_000 || !file.type.startsWith('image/')) {
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
        (blob) => {
          const compressed = new File([blob], file.name, { type: 'image/jpeg' });
          console.log(`[scan] Compressed: ${(file.size / 1024).toFixed(0)}KB -> ${(compressed.size / 1024).toFixed(0)}KB`);
          resolve(compressed);
        },
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
  const fileInputRef = useRef(null);
  const formRef = useRef(null);

  const [step, setStep] = useState('capture'); // capture | compressing | scanning | form | submitting
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [ocrResult, setOcrResult] = useState(null);
  const [toast, setToast] = useState(null);

  // Form fields
  const [amount, setAmount] = useState('');
  const [dateTicket, setDateTicket] = useState('');
  const [type, setType] = useState('autre');
  const [merchant, setMerchant] = useState('');
  const [description, setDescription] = useState('');

  const handleCapture = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Show preview immediately
    setImagePreview(URL.createObjectURL(file));
    setStep('compressing');

    try {
      // Compress image client-side before upload
      const compressed = await compressImage(file);
      setImageFile(compressed);
      setStep('scanning');

      // Send to OCR
      const formData = new FormData();
      formData.append('image', compressed);
      const result = await api.scanImage(formData);

      setOcrResult(result);

      // Pre-fill form with extracted data
      if (result.extracted) {
        if (result.extracted.amount) setAmount(String(result.extracted.amount));
        if (result.extracted.date) setDateTicket(result.extracted.date);
        if (result.extracted.type) setType(result.extracted.type);
        if (result.extracted.merchant) setMerchant(result.extracted.merchant);
        if (result.extracted.description) setDescription(result.extracted.description || '');
      }

      setStep('form');

      // Scroll to form on mobile
      setTimeout(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
    } catch (err) {
      console.error('OCR error:', err);
      setImageFile(file);
      setToast({ message: 'Erreur OCR — remplissez manuellement', type: 'warning' });
      setDateTicket(new Date().toISOString().slice(0, 10));
      setStep('form');
    }
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!amount || parseFloat(amount) <= 0) {
      setToast({ message: 'Montant requis', type: 'error' });
      return;
    }

    setStep('submitting');

    try {
      const formData = new FormData();
      if (imageFile) formData.append('image', imageFile);
      formData.append('amount', amount);
      formData.append('date_ticket', dateTicket || new Date().toISOString().slice(0, 10));
      formData.append('type', type);
      formData.append('merchant', merchant);
      formData.append('description', description);

      const result = await api.submitScan(formData);

      if (result.driveUrl) {
        setToast({ message: 'Ticket envoyé dans Google Drive', type: 'success' });
      } else {
        setToast({ message: 'Dépense enregistrée', type: 'success' });
      }

      setTimeout(() => navigate('/'), 2000);
    } catch (err) {
      console.error('Submit error:', err);
      setToast({ message: err.message || 'Erreur lors de l\'envoi', type: 'error' });
      setStep('form');
    }
  };

  const resetScan = () => {
    setStep('capture');
    setImageFile(null);
    if (imagePreview) URL.revokeObjectURL(imagePreview);
    setImagePreview(null);
    setOcrResult(null);
    setAmount('');
    setDateTicket('');
    setType('autre');
    setMerchant('');
    setDescription('');
    // Reset file input so same file can be re-selected
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className="space-y-6 animate-fade-up">
      {toast && <Toast {...toast} onClose={() => setToast(null)} />}

      <h1 className="font-serif text-xl font-semibold">Scanner un ticket</h1>

      {/* Capture Step */}
      {step === 'capture' && (
        <div>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="w-full border-2 border-dashed border-green-mid/35 rounded-4xl p-12 flex flex-col items-center gap-4 bg-green-mid/[0.04] transition-colors hover:bg-green-mid/[0.08] active:scale-[0.97]"
          >
            <span className="text-[52px] drop-shadow-[0_0_12px_rgba(77,158,64,0.3)]">📷</span>
            <div className="text-center">
              <p className="text-text font-medium">Prendre une photo</p>
              <p className="text-text-muted text-xs mt-1">ou choisir une image</p>
            </div>
          </button>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            capture="environment"
            onChange={handleCapture}
            className="hidden"
          />

          <div className="mt-4 p-4 rounded-2xl bg-card border border-card-border">
            <p className="text-text-muted text-xs leading-relaxed">
              💡 <strong className="text-text">Conseils :</strong> Posez le ticket sur une surface sombre,
              bonne lumière, photo à plat pour un meilleur résultat.
            </p>
          </div>
        </div>
      )}

      {/* Scanning Step (compressing + OCR) */}
      {(step === 'compressing' || step === 'scanning') && (
        <div className="flex flex-col items-center py-8 gap-4">
          {imagePreview && (
            <div className="relative w-48">
              <img src={imagePreview} alt="Ticket" className="w-full rounded-2xl opacity-60" />
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-14 h-14 border-3 border-green-mid border-t-transparent rounded-full animate-spin" />
              </div>
            </div>
          )}

          {/* Progress steps */}
          <div className="flex flex-col items-center gap-2 mt-2">
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${step === 'compressing' ? 'bg-green-mid animate-pulse' : 'bg-green-mid'}`} />
              <span className={`text-xs ${step === 'compressing' ? 'text-green-light' : 'text-text-muted'}`}>
                Compression de l'image
              </span>
            </div>
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${step === 'scanning' ? 'bg-green-mid animate-pulse' : 'bg-card'}`} />
              <span className={`text-xs ${step === 'scanning' ? 'text-green-light' : 'text-text-dim'}`}>
                Analyse OCR en cours…
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Form Step */}
      {(step === 'form' || step === 'submitting') && (
        <form ref={formRef} onSubmit={handleSubmit} className="space-y-4">
          {/* Image preview */}
          {imagePreview && (
            <div className="relative">
              <img src={imagePreview} alt="Ticket" className="w-full rounded-2xl max-h-64 object-cover" />
              <button
                type="button"
                onClick={resetScan}
                className="absolute top-2 right-2 bg-black/70 rounded-full px-3 py-1 text-xs text-white"
              >
                Reprendre
              </button>
            </div>
          )}

          {/* OCR confidence */}
          {ocrResult && (
            <div className={`p-3 rounded-xl border text-xs ${
              ocrResult.confidence >= 60
                ? 'bg-green-mid/10 border-green-mid/30 text-green-light'
                : 'bg-amber-900/20 border-amber-500/20 text-amber-300'
            }`}>
              {ocrResult.confidence >= 60
                ? `Confiance OCR : ${Math.round(ocrResult.confidence)}% — Vérifiez les données`
                : `Confiance OCR faible : ${Math.round(ocrResult.confidence || 0)}% — Corrigez les données`
              }
            </div>
          )}

          {/* Amount */}
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-text-muted mb-2">
              Montant (€)
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
              placeholder="0.00"
              className="w-full bg-card border border-card-border rounded-2xl px-5 py-4 text-text text-lg font-serif focus:outline-none focus:border-green-mid"
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
            <label className="block text-[10px] uppercase tracking-widest text-text-muted mb-2">
              Type de dépense
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
              Commerçant
            </label>
            <input
              type="text"
              value={merchant}
              onChange={(e) => setMerchant(e.target.value)}
              maxLength={255}
              placeholder="Nom du commerçant"
              className="w-full bg-card border border-card-border rounded-2xl px-5 py-4 text-text focus:outline-none focus:border-green-mid"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-text-muted mb-2">
              Description
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={500}
              placeholder="Description courte"
              className="w-full bg-card border border-card-border rounded-2xl px-5 py-4 text-text focus:outline-none focus:border-green-mid"
            />
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={step === 'submitting'}
            className="w-full py-5 rounded-3xl text-white font-semibold text-base transition-transform active:scale-[0.97] disabled:opacity-50 flex items-center justify-center gap-3"
            style={{
              background: 'linear-gradient(135deg, #2D6A27, #4A9E40)',
              boxShadow: '0 4px 20px rgba(77, 158, 64, 0.3)',
            }}
          >
            {step === 'submitting' ? (
              <>
                <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Envoi en cours…
              </>
            ) : (
              <>📁 Envoyer dans Google Drive</>
            )}
          </button>
        </form>
      )}
    </div>
  );
}
