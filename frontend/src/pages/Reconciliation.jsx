import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../utils/api';
import Toast from '../components/Toast';

const MONTHS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];

function fmt(n) {
  return Number(n || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function CardBlock({ card, onSaveLabel }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(card.label || '');
  const [saving, setSaving] = useState(false);
  const allOk = card.missing === 0;

  async function save() {
    setSaving(true);
    await onSaveLabel(card, label.trim());
    setSaving(false);
    setEditing(false);
  }

  return (
    <div className="rounded-2xl bg-card border border-card-border overflow-hidden">
      <div className="p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-3 min-w-0">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-lg ${allOk ? 'bg-green-mid/20 text-green-light' : 'bg-amber-500/20 text-amber-400'}`}>
              {allOk ? '✅' : '⚠️'}
            </div>
            <div className="min-w-0">
              {editing ? (
                <div className="flex items-center gap-2">
                  <input
                    autoFocus
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    placeholder="Intitulé de la carte"
                    className="bg-bg2 border border-card-border rounded-lg px-2 py-1 text-sm text-text w-40 focus:outline-none focus:border-green-mid"
                    onKeyDown={(e) => e.key === 'Enter' && save()}
                  />
                  <button onClick={save} disabled={saving} className="text-green-light text-xs font-medium">
                    {saving ? '…' : 'OK'}
                  </button>
                </div>
              ) : (
                <button onClick={() => { setEditing(true); setLabel(card.label || ''); }} className="text-left">
                  <p className="text-text text-sm font-medium truncate">
                    {card.label || 'Carte sans intitulé'} <span className="text-text-dim">✏️</span>
                  </p>
                </button>
              )}
              <p className="text-text-muted text-xs font-mono">•••• {card.last4}</p>
            </div>
          </div>
          <div className="text-right shrink-0">
            <p className={`font-serif text-base font-semibold ${allOk ? 'text-green-light' : 'text-amber-400'}`}>
              {card.missing}/{card.transactions}
            </p>
            <p className="text-text-muted text-[11px]">sans justif.</p>
          </div>
        </div>

        {card.missing > 0 && (
          <button
            onClick={() => setOpen((o) => !o)}
            className="mt-3 w-full text-left text-xs text-amber-400 flex items-center justify-between"
          >
            <span>{fmt(card.amount_missing)} € de paiements non justifiés</span>
            <span>{open ? '▲' : '▼'}</span>
          </button>
        )}
      </div>

      {open && card.missing > 0 && (
        <div className="border-t border-card-border divide-y divide-card-border/50">
          {card.missing_list.map((m) => (
            <div key={m.transaction_id} className="flex items-center justify-between gap-2 px-4 py-2.5">
              <div className="min-w-0">
                <p className="text-text text-xs font-medium truncate">{m.label || 'Transaction'}</p>
                <p className="text-text-muted text-[11px]">
                  {new Date(m.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
                </p>
              </div>
              <p className="font-serif text-sm font-semibold text-amber-400 shrink-0">{fmt(m.amount)} €</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Reconciliation() {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, year]);

  async function load() {
    setLoading(true);
    try {
      const res = await api.getReconciliation({ month, year });
      setData(res);
    } catch (err) {
      setToast({ message: err.message || 'Erreur de chargement', type: 'error' });
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  function changeMonth(delta) {
    let m = month + delta;
    let y = year;
    if (m < 1) { m = 12; y -= 1; }
    if (m > 12) { m = 1; y += 1; }
    setMonth(m);
    setYear(y);
  }

  async function saveLabel(card, label) {
    if (!card.mapping_id) {
      setToast({ message: 'Carte non enregistrée — relancez le rapprochement', type: 'error' });
      return;
    }
    try {
      await api.updateCardMapping(card.mapping_id, { label });
      setData((d) => ({
        ...d,
        cards: d.cards.map((c) => (c.mapping_id === card.mapping_id ? { ...c, label } : c)),
      }));
      setToast({ message: 'Intitulé enregistré', type: 'success' });
    } catch (err) {
      setToast({ message: err.message || 'Erreur', type: 'error' });
    }
  }

  const connectionKo = data && data.connection && data.connection.ok === false;

  return (
    <div className="space-y-6 animate-fade-up">
      {toast && <Toast {...toast} onClose={() => setToast(null)} />}

      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="font-serif text-xl font-semibold">Rapprochement</h1>
        <Link to="/admin" className="text-text-muted text-xs">← Admin</Link>
      </div>

      {/* Month selector */}
      <div className="flex items-center justify-between bg-card border border-card-border rounded-2xl px-2 py-2">
        <button onClick={() => changeMonth(-1)} className="w-9 h-9 rounded-xl text-text-muted hover:text-text">‹</button>
        <span className="text-text text-sm font-medium">{MONTHS[month - 1]} {year}</span>
        <button onClick={() => changeMonth(1)} className="w-9 h-9 rounded-xl text-text-muted hover:text-text">›</button>
      </div>

      {/* Connection problem */}
      {connectionKo && (
        <div className="rounded-2xl bg-amber-500/10 border border-amber-500/30 p-4">
          <p className="text-amber-300 text-sm font-medium mb-1">⚠️ Pennylane non connecté</p>
          <p className="text-text-muted text-xs">
            {data.message || data.connection.error}
          </p>
          <p className="text-text-dim text-[11px] mt-2">
            Ajoutez la variable <span className="font-mono">PENNYLANE_API_TOKEN</span> dans la configuration Railway.
          </p>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin w-8 h-8 border-2 border-green-mid border-t-transparent rounded-full" />
        </div>
      ) : data && data.totals ? (
        <>
          {/* Hero summary */}
          <div className="relative overflow-hidden rounded-4xl p-7"
            style={{ background: 'linear-gradient(135deg, #1C3A1E, #243F26)' }}>
            <div className="relative z-10">
              <p className="text-text-muted text-sm mb-1">Paiements sans justificatif</p>
              <p className="font-serif text-[38px] font-bold text-amber-400 leading-tight">
                {data.totals.missing}
                <span className="text-xl ml-2 text-text-muted">/ {data.totals.transactions}</span>
              </p>
              <p className="text-text-muted text-sm mt-1">
                {fmt(data.totals.amount_missing)} € à justifier · {data.totals.matched} rapprochés
              </p>
            </div>
            <div className="absolute top-4 right-4 text-[70px] opacity-[0.08] select-none">🧾</div>
          </div>

          {/* Per-card */}
          <div>
            <h2 className="text-text-muted text-xs uppercase tracking-widest mb-3">Par carte</h2>
            <div className="space-y-3">
              {data.cards.map((card) => (
                <CardBlock key={card.masked_number} card={card} onSaveLabel={saveLabel} />
              ))}
              {data.cards.length === 0 && (
                <p className="text-text-dim text-center py-8 text-sm">Aucune transaction carte sur cette période</p>
              )}
            </div>
          </div>

          {/* Orphan scans */}
          {data.orphanScans && data.orphanScans.length > 0 && (
            <div>
              <h2 className="text-text-muted text-xs uppercase tracking-widest mb-3">
                Scans sans transaction ({data.orphanScans.length})
              </h2>
              <div className="space-y-2">
                {data.orphanScans.slice(0, 30).map((s) => (
                  <div key={s.id} className="flex items-center justify-between gap-2 p-3 rounded-2xl bg-card border border-card-border">
                    <div className="min-w-0">
                      <p className="text-text text-xs font-medium truncate">{s.merchant || 'Sans commerçant'}</p>
                      <p className="text-text-muted text-[11px]">
                        {s.user_name} · {new Date(s.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
                      </p>
                    </div>
                    <p className="font-serif text-sm font-semibold text-text shrink-0">{fmt(s.amount)} €</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        !connectionKo && <p className="text-text-dim text-center py-8 text-sm">Aucune donnée</p>
      )}
    </div>
  );
}
