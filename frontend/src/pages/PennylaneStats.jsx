import React, { useEffect, useState, useRef } from 'react';
import { api } from '../utils/api';

// Exercice fiscal : juillet -> juin
const FY_MONTHS = ['07', '08', '09', '10', '11', '12', '01', '02', '03', '04', '05', '06'];
const MONTH_LABELS = {
  '01': 'Jan', '02': 'Fév', '03': 'Mar', '04': 'Avr', '05': 'Mai', '06': 'Juin',
  '07': 'Juil', '08': 'Aoû', '09': 'Sep', '10': 'Oct', '11': 'Nov', '12': 'Déc',
};
const PALETTE = ['#5ABF50', '#3B82F6', '#F59E0B', '#A855F7', '#EC4899', '#14B8A6', '#EF4444', '#8B5CF6', '#10B981', '#F97316', '#0EA5E9', '#84CC16'];
const eur = (n) => `${Number(n || 0).toFixed(2)}€`;

export default function PennylaneStats({ toast }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [fUser, setFUser] = useState('');
  const [fCard, setFCard] = useState('');
  const [fCat, setFCat] = useState('');
  const [fVeh, setFVeh] = useState('');
  const [showScans, setShowScans] = useState(false);
  const [showTx, setShowTx] = useState(false);
  const [txLimit, setTxLimit] = useState(30);
  const [scanDetail, setScanDetail] = useState({}); // { [scanId]: { loading, pdfUrl, transaction } }
  const [txDetail, setTxDetail] = useState({}); // { [txId]: { loading, invoice, pdfUrl, scan, open } }
  const loadedRef = useRef(false);

  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    load();
  }, []);

  async function load(year) {
    setLoading(true);
    try {
      const d = await api.getPennylaneStats(year ? { year } : {});
      setData(d);
    } catch (e) {
      toast?.({ message: 'Erreur stats : ' + e.message, type: 'error' });
    } finally {
      setLoading(false);
    }
  }

  // Dès qu'un filtre est actif, on déplie la liste des transactions liées
  useEffect(() => {
    if (fUser || fCard || fCat || fVeh) setShowTx(true);
    setTxLimit(30);
  }, [fUser, fCard, fCat, fVeh]);

  async function loadTxDetail(id) {
    if (txDetail[id]?.loading || txDetail[id]?.loaded) {
      setTxDetail(td => ({ ...td, [id]: { ...td[id], open: !td[id].open } }));
      return;
    }
    setTxDetail(td => ({ ...td, [id]: { loading: true, open: true } }));
    try {
      const d = await api.getPennylaneTransactionDetail(id);
      setTxDetail(td => ({ ...td, [id]: { ...d, loaded: true, open: true } }));
    } catch (e) {
      setTxDetail(td => ({ ...td, [id]: { error: e.message, loaded: true, open: true } }));
    }
  }

  async function loadScanDetail(id) {
    if (scanDetail[id]?.loading || scanDetail[id]?.loaded) {
      setScanDetail(sd => ({ ...sd, [id]: { ...sd[id], open: !sd[id].open } }));
      return;
    }
    setScanDetail(sd => ({ ...sd, [id]: { loading: true, open: true } }));
    try {
      const d = await api.getPennylaneScanDetail(id);
      setScanDetail(sd => ({ ...sd, [id]: { ...d, loaded: true, open: true } }));
    } catch (e) {
      setScanDetail(sd => ({ ...sd, [id]: { error: e.message, loaded: true, open: true } }));
    }
  }

  if (loading && !data) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-9 bg-card rounded-xl" />
        <div className="grid grid-cols-2 gap-3">{[1, 2, 3, 4].map(i => <div key={i} className="h-20 bg-card rounded-2xl" />)}</div>
        <div className="h-48 bg-card rounded-3xl" />
      </div>
    );
  }
  if (!data || data.connected === false) {
    return <p className="text-text-dim text-sm text-center py-12">Pennylane non connecté.</p>;
  }

  const fy = data.fiscalYear || {};
  // Filtrage client
  const txs = (data.transactions || []).filter(t =>
    (!fUser || String(t.userId) === String(fUser)) &&
    (!fCard || t.masked === fCard) &&
    (!fCat || t.nature === fCat) &&
    (!fVeh || t.vehicle === fVeh)
  );
  const scans = (data.scans || []).filter(s => !fUser || String(s.userId) === String(fUser));

  const total = txs.reduce((a, t) => a + t.amount, 0);
  const userName = (id) => (data.users || []).find(u => String(u.id) === String(id))?.name || `#${id}`;

  // Agrégations
  const sumBy = (key, fallback) => {
    const m = new Map();
    for (const t of txs) {
      const k = t[key] || fallback;
      m.set(k, (m.get(k) || 0) + t.amount);
    }
    return [...m.entries()].map(([k, v]) => ({ k, v })).sort((a, b) => b.v - a.v);
  };
  const byMonth = FY_MONTHS.map(mm => {
    const items = txs.filter(t => String(t.date).slice(5, 7) === mm);
    return { mm, total: items.reduce((a, t) => a + t.amount, 0), count: items.length };
  });
  const maxMonth = Math.max(...byMonth.map(m => m.total), 1);
  const byCat = sumBy('nature', 'Non catégorisé');
  const byVeh = sumBy('vehicle', 'Sans véhicule');
  const byCollab = (() => {
    const m = new Map();
    for (const t of txs) {
      const k = t.userId || 'none';
      const o = m.get(k) || { amount: 0, count: 0 };
      o.amount += t.amount; o.count += 1; m.set(k, o);
    }
    return [...m.entries()].map(([k, o]) => ({ k, name: k === 'none' ? 'Non attribué' : userName(k), ...o })).sort((a, b) => b.amount - a.amount);
  })();

  const Bars = ({ rows, fmtLabel }) => {
    const max = Math.max(...rows.map(r => r.v), 1);
    return (
      <div className="space-y-2.5">
        {rows.map((r, i) => (
          <div key={r.k}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-text text-xs">{fmtLabel ? fmtLabel(r.k) : r.k}</span>
              <span className="text-text font-mono text-xs font-medium">{eur(r.v)}</span>
            </div>
            <div className="h-2 rounded-full bg-card-border/60 overflow-hidden">
              <div className="h-full rounded-full transition-all duration-500"
                style={{ width: `${(r.v / max) * 100}%`, backgroundColor: PALETTE[i % PALETTE.length] }} />
            </div>
          </div>
        ))}
        {rows.length === 0 && <p className="text-text-dim text-xs text-center py-2">Aucune donnée</p>}
      </div>
    );
  };

  const selectCls = 'bg-bg border border-card-border rounded-lg px-2 py-1.5 text-text text-xs focus:outline-none focus:border-green-mid';
  const card = 'p-4 rounded-2xl bg-card border border-card-border';

  return (
    <div className={`space-y-5 ${loading ? 'opacity-60 pointer-events-none' : ''}`}>
      {/* Année comptable */}
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {(data.availableYears || []).map(y => (
          <button key={y} onClick={() => load(y)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap ${
              y === fy.startYear ? 'bg-green-mid/20 border border-green-mid text-green-light' : 'bg-card border border-card-border text-text-muted'
            }`}>
            Exercice {y}-{y + 1}
          </button>
        ))}
      </div>

      {/* Filtres */}
      <div className="grid grid-cols-2 gap-2">
        <select value={fUser} onChange={e => setFUser(e.target.value)} className={selectCls}>
          <option value="">{'👤'} Tous collaborateurs</option>
          {(data.users || []).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <select value={fCard} onChange={e => setFCard(e.target.value)} className={selectCls}>
          <option value="">{'💳'} Toutes cartes</option>
          {(data.cards || []).map(c => <option key={c.masked} value={c.masked}>{c.label || `•••• ${c.last4}`}</option>)}
        </select>
        <select value={fCat} onChange={e => setFCat(e.target.value)} className={selectCls}>
          <option value="">{'🏷️'} Toutes catégories</option>
          {(data.categories || []).map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={fVeh} onChange={e => setFVeh(e.target.value)} className={selectCls}>
          <option value="">{'🚐'} Tous véhicules</option>
          {(data.vehicles || []).map(v => <option key={v} value={v}>{v}</option>)}
        </select>
      </div>
      {(fUser || fCard || fCat || fVeh) && (
        <button onClick={() => { setFUser(''); setFCard(''); setFCat(''); setFVeh(''); }}
          className="text-text-muted text-xs underline">Réinitialiser les filtres</button>
      )}

      {/* Résumé */}
      <div className="grid grid-cols-2 gap-3">
        <div className={card}>
          <p className="text-text-muted text-[10px] uppercase tracking-widest">Total dépensé</p>
          <p className="font-serif text-2xl font-bold text-green-light mt-1">{eur(total)}</p>
        </div>
        <div className={card}>
          <p className="text-text-muted text-[10px] uppercase tracking-widest">Transactions</p>
          <p className="font-serif text-2xl font-bold text-text mt-1">{txs.length}</p>
        </div>
        <div className={card}>
          <p className="text-text-muted text-[10px] uppercase tracking-widest">Moyenne / op.</p>
          <p className="font-serif text-2xl font-bold text-text mt-1">{eur(txs.length ? total / txs.length : 0)}</p>
        </div>
        <div className={card}>
          <p className="text-text-muted text-[10px] uppercase tracking-widest">Scans réalisés</p>
          <p className="font-serif text-2xl font-bold text-text mt-1">{scans.length}</p>
          <p className="text-text-dim text-[10px] mt-0.5">{scans.filter(s => s.matched).length} rapprochés</p>
        </div>
      </div>

      {/* Graphique mensuel (exercice juil -> juin) */}
      <div className="p-5 rounded-3xl bg-card border border-card-border">
        <p className="text-text-muted text-[10px] uppercase tracking-widest mb-4">Dépenses par mois — exercice {fy.label}</p>
        <div className="flex items-end gap-1">
          {byMonth.map(m => {
            // hauteur en px (le % ne marche pas dans une colonne à hauteur auto)
            const BAR_MAX = 110;
            const px = m.total > 0 ? Math.max((m.total / maxMonth) * BAR_MAX, 8) : 3;
            const isMax = m.total > 0 && m.total === maxMonth;
            return (
              <div key={m.mm} className="flex-1 flex flex-col items-center gap-1">
                <span className={`font-mono leading-none text-[11px] ${
                  isMax ? 'text-green-light font-bold' : m.total > 0 ? 'text-text-muted' : 'text-transparent'
                }`}>
                  {m.total > 0 ? Math.round(m.total) : '·'}
                </span>
                <div className="w-full rounded-t-md transition-all duration-500"
                  style={{
                    height: `${px}px`,
                    background: m.total > 0
                      ? (isMax ? 'linear-gradient(180deg,#7BDF70,#3D8A37)' : 'linear-gradient(180deg,#5ABF50,#2D6A27)')
                      : 'rgba(255,255,255,0.06)',
                    boxShadow: isMax ? '0 0 12px rgba(90,191,80,0.35)' : 'none',
                  }} />
                <span className={`text-[11px] leading-none ${m.total > 0 ? 'text-text' : 'text-text-dim'}`}>
                  {MONTH_LABELS[m.mm]}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Transactions liées (selon les filtres) */}
      <div className="rounded-3xl bg-card border border-card-border overflow-hidden">
        <button onClick={() => setShowTx(s => !s)} className="w-full flex items-center justify-between p-5">
          <p className="text-text-muted text-[10px] uppercase tracking-widest">
            Transactions {(fUser || fCard || fCat || fVeh) ? 'filtrées' : ''} ({txs.length})
          </p>
          <span className="text-text-muted text-xs">{showTx ? '▲' : '▼'}</span>
        </button>
        {showTx && (
          <div className="border-t border-card-border divide-y divide-card-border/40">
            {txs.length === 0 && <p className="text-text-dim text-xs text-center py-6">Aucune transaction</p>}
            {[...txs]
              .sort((a, b) => (a.date < b.date ? 1 : -1))
              .slice(0, txLimit)
              .map(t => {
                const det = txDetail[t.id];
                return (
                  <div key={t.id} className="px-4 py-2.5">
                    <button onClick={() => loadTxDetail(t.id)} className="w-full text-left">
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-text text-xs font-medium truncate">{t.label || 'Transaction'}</p>
                          <p className="text-text-muted text-[10px]">
                            {new Date(t.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: '2-digit' })}
                            {t.cardLabel || t.last4 ? ` · ${t.cardLabel || `•••• ${t.last4}`}` : ''}
                            {t.userId ? ` · ${userName(t.userId)}` : ''}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <p className="font-serif text-sm font-semibold text-text">-{eur(t.amount)}</p>
                          <span className="text-text-dim text-[10px]">{det?.open ? '▲' : '▼'}</span>
                        </div>
                      </div>
                      {(t.nature || t.vehicle) && (
                        <div className="flex gap-1.5 mt-1">
                          {t.nature && <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-green-mid/15 text-green-light">{t.nature}</span>}
                          {t.vehicle && <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-blue-500/15 text-blue-300">{'🚐'} {t.vehicle}</span>}
                        </div>
                      )}
                    </button>
                    {det?.open && (
                      <div className="mt-2 p-2.5 rounded-xl bg-bg border border-card-border/60 space-y-1.5">
                        {det.loading && <p className="text-text-dim text-[10px]">Chargement…</p>}
                        {det.error && <p className="text-red-400 text-[10px]">Erreur : {det.error}</p>}
                        {det.loaded && !det.error && (
                          det.invoice ? (
                            <>
                              <div>
                                <p className="text-text-muted text-[11px] uppercase tracking-widest">Justificatif</p>
                                <p className="text-text text-[11px] truncate">
                                  {det.scan?.merchant || det.invoice.label || det.invoice.filename || `Facture #${det.invoice.id}`}
                                </p>
                                <p className="text-text-muted text-[10px]">
                                  {det.invoice.date ? new Date(det.invoice.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: '2-digit' }) : ''}
                                  {det.invoice.amount ? ` · ${eur(det.invoice.amount)}` : ''}
                                  {det.scan ? ` · scanné par ${det.scan.userName || '?'} (${det.scan.type})` : ''}
                                </p>
                              </div>
                              {det.pdfUrl ? (
                                <a href={det.pdfUrl} target="_blank" rel="noopener noreferrer"
                                  className="block text-center py-1.5 rounded-lg bg-green-mid/20 text-green-light text-[10px] font-medium">
                                  {'📄'} Voir le justificatif
                                </a>
                              ) : (
                                <p className="text-text-dim text-[10px]">PDF non disponible</p>
                              )}
                            </>
                          ) : (
                            <p className="text-amber-400 text-[10px]">Aucun justificatif lié à ce paiement pour l'instant</p>
                          )
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            {txs.length > txLimit && (
              <button onClick={() => setTxLimit(l => l + 50)}
                className="w-full py-2.5 text-green-light text-xs font-medium">
                Afficher plus ({txs.length - txLimit} restantes)
              </button>
            )}
          </div>
        )}
      </div>

      {/* Par catégorie */}
      <div className="p-5 rounded-3xl bg-card border border-card-border">
        <p className="text-text-muted text-[10px] uppercase tracking-widest mb-4">Par catégorie</p>
        <Bars rows={byCat} />
      </div>

      {/* Par véhicule */}
      <div className="p-5 rounded-3xl bg-card border border-card-border">
        <p className="text-text-muted text-[10px] uppercase tracking-widest mb-4">Par véhicule</p>
        <Bars rows={byVeh} />
      </div>

      {/* Par collaborateur */}
      <div className="p-5 rounded-3xl bg-card border border-card-border">
        <p className="text-text-muted text-[10px] uppercase tracking-widest mb-4">Par collaborateur</p>
        <Bars rows={byCollab.map(c => ({ k: c.name, v: c.amount }))} />
      </div>

      {/* Scans réalisés */}
      <div className="rounded-3xl bg-card border border-card-border overflow-hidden">
        <button onClick={() => setShowScans(s => !s)} className="w-full flex items-center justify-between p-5">
          <p className="text-text-muted text-[10px] uppercase tracking-widest">Scans réalisés ({scans.length})</p>
          <span className="text-text-muted text-xs">{showScans ? '▲' : '▼'}</span>
        </button>
        {showScans && (
          <div className="border-t border-card-border divide-y divide-card-border/40 max-h-[420px] overflow-y-auto">
            {scans.length === 0 && <p className="text-text-dim text-xs text-center py-6">Aucun scan</p>}
            {scans.map(s => {
              const det = scanDetail[s.id];
              return (
                <div key={s.id} className="px-4 py-2.5">
                  <button onClick={() => loadScanDetail(s.id)} className="w-full text-left">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-text text-xs font-medium truncate">{s.merchant || 'Sans marchand'}</p>
                        <p className="text-text-muted text-[10px]">
                          {new Date(s.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: '2-digit' })}
                          {' · '}{s.type}{' · '}{s.userName || '?'}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className={`text-[11px] px-1.5 py-0.5 rounded-full ${s.matched ? 'bg-green-mid/20 text-green-light' : 'bg-card-border/60 text-text-dim'}`}>
                          {s.matched ? 'rapproché' : 'non rapproché'}
                        </span>
                        <span className="font-serif text-sm font-semibold text-text">{eur(s.amount)}</span>
                        <span className="text-text-dim text-[10px]">{det?.open ? '▲' : '▼'}</span>
                      </div>
                    </div>
                  </button>
                  {det?.open && (
                    <div className="mt-2 p-2.5 rounded-xl bg-bg border border-card-border/60 space-y-1.5">
                      {det.loading && <p className="text-text-dim text-[10px]">Chargement…</p>}
                      {det.error && <p className="text-red-400 text-[10px]">Erreur : {det.error}</p>}
                      {det.loaded && !det.error && (
                        <>
                          {det.transaction ? (
                            <div className="flex items-center justify-between gap-2">
                              <div className="min-w-0">
                                <p className="text-text-muted text-[11px] uppercase tracking-widest">Transaction liée</p>
                                <p className="text-text text-[11px] truncate">{det.transaction.label || 'Transaction'}</p>
                                <p className="text-text-muted text-[10px]">
                                  {new Date(det.transaction.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: '2-digit' })}
                                </p>
                              </div>
                              <p className="font-serif text-sm font-semibold text-green-light shrink-0">-{eur(det.transaction.amount)}</p>
                            </div>
                          ) : (
                            <p className="text-text-dim text-[10px]">Pas encore de transaction bancaire liée</p>
                          )}
                          <div className="flex gap-2 pt-1">
                            {(det.pdfUrl || s.fileUrl) && (
                              <a href={det.pdfUrl || s.fileUrl} target="_blank" rel="noopener noreferrer"
                                className="flex-1 text-center py-1.5 rounded-lg bg-green-mid/20 text-green-light text-[10px] font-medium">
                                {'📄'} Voir le justificatif
                              </a>
                            )}
                            {!det.pdfUrl && !s.fileUrl && <p className="text-text-dim text-[10px]">Pas de PDF disponible</p>}
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
