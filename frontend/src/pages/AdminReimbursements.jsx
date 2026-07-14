import React, { useEffect, useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../utils/api';
import Toast from '../components/Toast';

const TABS = [
  { id: 'pending', label: 'En attente' },
  { id: 'reimbursed', label: 'Remboursées' },
  { id: 'rejected', label: 'Refusées' },
];

export default function AdminReimbursements() {
  const [toast, setToast] = useState(null);
  const [tab, setTab] = useState('pending');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const loadedRef = useRef(false);

  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    load('pending');
  }, []);

  async function load(status) {
    setLoading(true);
    try {
      const d = await api.getReimbursements(status);
      setData(d);
    } catch (err) {
      setToast({ message: err.message, type: 'error' });
    } finally {
      setLoading(false);
    }
  }

  function switchTab(id) {
    setTab(id);
    load(id);
  }

  async function setStatus(id, status) {
    setBusyId(id);
    try {
      await api.updateReimbursement(id, status);
      setData(d => d ? { ...d, requests: d.requests.filter(r => r.id !== id) } : d);
      setToast({
        message: status === 'reimbursed' ? 'Marquée remboursée' : status === 'rejected' ? 'Demande refusée' : 'Réouverte',
        type: 'success',
      });
    } catch (err) {
      setToast({ message: err.message, type: 'error' });
    } finally {
      setBusyId(null);
    }
  }

  const requests = data?.requests || [];
  const summary = data?.summary || { pending: 0, reimbursed: 0, rejected: 0 };

  return (
    <div className="space-y-6">
      {toast && <Toast {...toast} onClose={() => setToast(null)} />}

      {/* Header */}
      <div className="flex items-center gap-3">
        <Link to="/admin" className="text-text-muted hover:text-text transition-colors">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
        </Link>
        <h1 className="font-serif text-xl font-semibold">Remboursements</h1>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-card rounded-2xl p-1">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => switchTab(t.id)}
            className={`flex-1 py-2 rounded-xl text-xs font-medium transition-colors ${
              tab === t.id ? 'bg-amber-500/20 text-amber-300' : 'text-text-muted'
            }`}
          >
            {t.label}
            {t.id === 'pending' && summary.pending > 0 && (
              <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-amber-500 text-white text-[10px] font-bold">{summary.pending}</span>
            )}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-10">
          <span className="w-6 h-6 border-2 border-amber-500/30 border-t-amber-500 rounded-full animate-spin" />
        </div>
      ) : requests.length === 0 ? (
        <p className="text-text-dim text-center py-10 text-sm">
          {tab === 'pending' ? 'Aucune demande en attente' : 'Aucune demande'}
        </p>
      ) : (
        <div className="space-y-2">
          {requests.map(r => (
            <div key={r.id} className="p-4 rounded-2xl bg-card border border-card-border space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-text text-sm font-medium">{r.userName || 'Collaborateur'}</p>
                  <p className="text-text-muted text-xs">
                    {r.merchant || r.type} · {new Date(r.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300">{r.paymentLabel}</span>
                    {r.driveUrl && (
                      <a href={r.driveUrl} target="_blank" rel="noreferrer" className="text-[10px] text-blue-400 underline">
                        Justificatif
                      </a>
                    )}
                  </div>
                  {r.description && <p className="text-text-dim text-[11px] mt-1">{r.description}</p>}
                </div>
                <p className="font-serif text-lg font-semibold text-text shrink-0">{Number(r.amount).toFixed(2)} {'€'}</p>
              </div>

              {r.status === 'pending' ? (
                <div className="flex gap-2">
                  <button
                    onClick={() => setStatus(r.id, 'reimbursed')}
                    disabled={busyId === r.id}
                    className="flex-1 py-2 rounded-xl bg-green-mid text-white text-xs font-medium transition-transform active:scale-[0.97] disabled:opacity-50"
                  >
                    Marquer rembours{'é'}e
                  </button>
                  <button
                    onClick={() => setStatus(r.id, 'rejected')}
                    disabled={busyId === r.id}
                    className="px-4 py-2 rounded-xl bg-card border border-red-500/30 text-red-400 text-xs font-medium transition-transform active:scale-[0.97] disabled:opacity-50"
                  >
                    Refuser
                  </button>
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <span className={`text-[11px] font-medium ${r.status === 'reimbursed' ? 'text-green-400' : 'text-red-400'}`}>
                    {r.status === 'reimbursed'
                      ? `Rembours${'é'}e${r.reimbursedAt ? ' le ' + new Date(r.reimbursedAt).toLocaleDateString('fr-FR') : ''}`
                      : 'Refus' + 'ée'}
                  </span>
                  <button
                    onClick={() => setStatus(r.id, 'pending')}
                    disabled={busyId === r.id}
                    className="text-text-muted text-[11px] underline disabled:opacity-50"
                  >
                    R{'é'}ouvrir
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
