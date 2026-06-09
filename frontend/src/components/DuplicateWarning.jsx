import React from 'react';

export default function DuplicateWarning({ duplicate, onConfirm, onCancel, loading }) {
  if (!duplicate) return null;

  const date = new Date(duplicate.date_ticket).toLocaleDateString('fr-FR', {
    day: 'numeric', month: 'long', year: 'numeric',
  });

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative bg-bg2 border border-amber-500/30 rounded-3xl p-6 max-w-sm w-full space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/20 flex items-center justify-center shrink-0">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-400">
              <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          </div>
          <div>
            <p className="text-white font-semibold text-sm">Doublon possible</p>
            <p className="text-text-muted text-xs">Une d{'é'}pense similaire existe d{'é'}j{'à'}</p>
          </div>
        </div>

        <div className="bg-card border border-card-border rounded-2xl p-4 space-y-1.5">
          <div className="flex justify-between text-sm">
            <span className="text-text-muted">Montant</span>
            <span className="text-white font-semibold">{Number(duplicate.amount).toFixed(2)} {'€'}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-text-muted">Date</span>
            <span className="text-white">{date}</span>
          </div>
          {duplicate.merchant && (
            <div className="flex justify-between text-sm">
              <span className="text-text-muted">Commer{'ç'}ant</span>
              <span className="text-white truncate ml-4">{duplicate.merchant}</span>
            </div>
          )}
          {duplicate.type && (
            <div className="flex justify-between text-sm">
              <span className="text-text-muted">Type</span>
              <span className="text-white">{duplicate.type}</span>
            </div>
          )}
        </div>

        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 py-3 rounded-2xl border border-card-border text-text-muted text-sm font-medium transition-colors active:scale-[0.97]"
          >
            Annuler
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className="flex-1 py-3 rounded-2xl bg-amber-600 text-white text-sm font-semibold transition-transform active:scale-[0.97] disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {loading ? (
              <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              'Enregistrer quand même'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
