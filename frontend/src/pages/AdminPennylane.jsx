import React, { useEffect, useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../utils/api';
import Toast from '../components/Toast';
import PennylaneStats from './PennylaneStats';

export default function AdminPennylane() {
  const [toast, setToast] = useState(null);
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [unmatched, setUnmatched] = useState([]);
  const [reconciling, setReconciling] = useState(false);
  const [results, setResults] = useState(null);
  const [tokenInput, setTokenInput] = useState('');
  const [savingToken, setSavingToken] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [invoices, setInvoices] = useState(null);
  const [transactions, setTransactions] = useState(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [debugData, setDebugData] = useState(null);
  const [loadingDebug, setLoadingDebug] = useState(false);
  const [bankAccounts, setBankAccounts] = useState([]);
  const [selectedBank, setSelectedBank] = useState(null);
  const [loadingBanks, setLoadingBanks] = useState(false);
  const [missing, setMissing] = useState(null);
  const [loadingMissing, setLoadingMissing] = useState(false);
  const [editingCard, setEditingCard] = useState(null);
  const [cardLabelInput, setCardLabelInput] = useState('');
  const [savingCard, setSavingCard] = useState(false);
  const [openCard, setOpenCard] = useState(null);
  const [users, setUsers] = useState([]);
  const [search, setSearch] = useState('');
  const [vehicleOptions, setVehicleOptions] = useState([]);
  const [cardVehicles, setCardVehicles] = useState({});
  const loadedRef = useRef(false);

  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    loadStatus();
  }, []);

  async function loadStatus() {
    try {
      const [s, u] = await Promise.all([
        api.getPennylaneStatus(),
        api.getPennylaneUnmatched().catch(() => ({ expenses: [], count: 0 })),
      ]);
      setStatus(s);
      setUnmatched(u.expenses || []);
      if (s.connected) {
        api.getPennylaneBankAccounts().then(data => {
          setBankAccounts(data.accounts || []);
          setSelectedBank(data.selectedId || null);
        }).catch(() => {});
      }
      api.getUsers().then(d => setUsers(d.users || [])).catch(() => {});
    } catch (err) {
      setStatus({ connected: false, error: err.message });
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveToken() {
    if (!tokenInput.trim()) return;
    setSavingToken(true);
    try {
      const result = await api.savePennylaneToken(tokenInput.trim());
      setStatus(result);
      setTokenInput('');
      setShowConfig(false);
      setToast({ message: result.connected ? 'Pennylane connecté' : 'Token sauvegardé mais connexion échouée', type: result.connected ? 'success' : 'error' });
    } catch (err) {
      setToast({ message: err.message, type: 'error' });
    } finally {
      setSavingToken(false);
    }
  }

  async function handleReconcile() {
    setReconciling(true);
    setResults(null);
    try {
      const data = await api.pennylaneReconcile();
      setResults(data);
      const { matched, alreadyReconciled, noInvoice, noTransaction, errors } = data.summary;
      const totalOk = matched + (alreadyReconciled || 0);
      setToast({
        message: `Rapprochement terminé : ${totalOk} rapproché(s)${alreadyReconciled ? ` (dont ${alreadyReconciled} déjà fait)` : ''}, ${noInvoice + noTransaction} sans match, ${errors} erreur(s)`,
        type: totalOk > 0 ? 'success' : 'warning',
      });
      const u = await api.getPennylaneUnmatched().catch(() => ({ expenses: [] }));
      setUnmatched(u.expenses || []);
    } catch (err) {
      setToast({ message: err.message, type: 'error' });
    } finally {
      setReconciling(false);
    }
  }

  // Exercice fiscal LBDP : 1er juillet -> 30 juin
  function fiscalYear() {
    const now = new Date();
    const y = now.getFullYear();
    const startYear = (now.getMonth() + 1) >= 7 ? y : y - 1;
    return {
      from: `${startYear}-07-01`,
      to: `${startYear + 1}-06-30`,
      label: `${startYear}-${startYear + 1}`,
    };
  }
  const fyLabel = fiscalYear().label;

  async function loadInvoices() {
    try {
      const fy = fiscalYear();
      const data = await api.getPennylaneInvoices({
        date_from: fy.from,
        date_to: fy.to,
        limit: 100,
      });
      setInvoices(data);
    } catch (err) {
      setToast({ message: 'Erreur chargement factures: ' + err.message, type: 'error' });
    }
  }

  async function loadTransactions() {
    try {
      const fy = fiscalYear();
      const data = await api.getPennylaneTransactions({
        date_from: fy.from,
        date_to: fy.to,
        expenses_only: 'true',
        limit: 100,
      });
      setTransactions(data);
    } catch (err) {
      setToast({ message: 'Erreur chargement transactions: ' + err.message, type: 'error' });
    }
  }

  async function handleSelectBank(accountId) {
    try {
      await api.savePennylaneBankAccount(accountId);
      setSelectedBank(String(accountId));
      setTransactions(null);
      setToast({ message: 'Compte bancaire sélectionné', type: 'success' });
    } catch (err) {
      setToast({ message: err.message, type: 'error' });
    }
  }

  async function handleDebug() {
    setLoadingDebug(true);
    try {
      const data = await api.getPennylaneDebug();
      setDebugData(data);
    } catch (err) {
      setToast({ message: 'Debug error: ' + err.message, type: 'error' });
    } finally {
      setLoadingDebug(false);
    }
  }

  async function loadMissing({ refresh = false } = {}) {
    setLoadingMissing(true);
    try {
      const data = await api.getPennylaneMissing({ refresh });
      setMissing(data);
      api.getPennylaneVehicles()
        .then(v => { setVehicleOptions(v.options || []); setCardVehicles(v.vehicles || {}); })
        .catch(() => {});
    } catch (err) {
      setToast({ message: 'Erreur: ' + err.message, type: 'error' });
    } finally {
      setLoadingMissing(false);
    }
  }

  function cardName(card) {
    if (!card) return 'Carte inconnue';
    if (card.label) return card.label;
    return card.last4 ? `•••• ${card.last4}` : 'Carte inconnue';
  }

  async function handleSaveCardLabel(masked) {
    setSavingCard(true);
    try {
      const label = cardLabelInput.trim();
      await api.savePennylaneCardLabel(masked, label);
      setMissing(m => m ? {
        ...m,
        cards: (m.cards || []).map(c => c.masked === masked ? { ...c, label: label || null } : c),
        transactions: (m.transactions || []).map(t =>
          t.card?.masked === masked ? { ...t, card: { ...t.card, label: label || null } } : t),
      } : m);
      setEditingCard(null);
      setCardLabelInput('');
      setToast({ message: 'Intitulé enregistré', type: 'success' });
    } catch (err) {
      setToast({ message: err.message, type: 'error' });
    } finally {
      setSavingCard(false);
    }
  }

  async function handleAssignCard(masked, userId) {
    try {
      await api.savePennylaneCardUser(masked, userId || null);
      setMissing(m => m ? {
        ...m,
        cards: (m.cards || []).map(c =>
          c.masked === masked ? { ...c, userId: userId ? parseInt(userId, 10) : null } : c),
      } : m);
      setToast({ message: userId ? 'Carte attribuée' : 'Attribution retirée', type: 'success' });
    } catch (err) {
      setToast({ message: err.message, type: 'error' });
    }
  }

  async function handleAssignVehicle(masked, categoryId) {
    try {
      await api.savePennylaneCardVehicle(masked, categoryId || null);
      setCardVehicles(cv => {
        const next = { ...cv };
        if (categoryId) next[masked] = parseInt(categoryId, 10);
        else delete next[masked];
        return next;
      });
      setToast({ message: categoryId ? 'Véhicule attribué' : 'Véhicule retiré', type: 'success' });
    } catch (err) {
      setToast({ message: err.message, type: 'error' });
    }
  }

  async function handleViewInvoice(invoiceId) {
    try {
      const detail = await api.getPennylaneInvoice(invoiceId);
      const fileUrl = detail.file_url || detail.document_url || detail.pdf_url;
      if (fileUrl) {
        window.open(fileUrl, '_blank');
      } else {
        setToast({ message: `Pas d'URL de fichier disponible. Champs: ${Object.keys(detail).join(', ')}`, type: 'warning' });
      }
    } catch (err) {
      setToast({ message: 'Erreur: ' + err.message, type: 'error' });
    }
  }

  function handleTabChange(tab) {
    setActiveTab(tab);
    setSearch('');
    if (tab === 'invoices' && !invoices) loadInvoices();
    if (tab === 'transactions' && !transactions) loadTransactions();
    if (tab === 'missing' && !missing) loadMissing();
  }

  const q = search.trim().toLowerCase();
  const matchText = (...vals) => !q || vals.some((v) => String(v ?? '').toLowerCase().includes(q));

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-7 bg-card rounded-xl w-48" />
        <div className="h-40 bg-card rounded-3xl" />
        <div className="h-24 bg-card rounded-2xl" />
      </div>
    );
  }

  const statusColor = status?.connected ? 'green' : 'red';

  return (
    <div className="space-y-6">
      {toast && <Toast {...toast} onClose={() => setToast(null)} />}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link to="/admin" className="text-text-muted hover:text-text transition-colors">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
          </Link>
          <h1 className="font-serif text-xl font-semibold">Pennylane</h1>
        </div>
        <div className={`flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium ${
          status?.connected
            ? 'bg-green-500/10 border border-green-500/30 text-green-400'
            : 'bg-red-500/10 border border-red-500/30 text-red-400'
        }`}>
          <span className={`w-2 h-2 rounded-full ${status?.connected ? 'bg-green-400' : 'bg-red-400'}`} />
          {status?.connected ? 'Connecté' : 'Déconnecté'}
        </div>
      </div>

      {/* Connection status card */}
      {!status?.connected && (
        <div className="p-4 rounded-2xl bg-red-500/5 border border-red-500/20 space-y-3">
          <p className="text-red-400 text-sm font-medium">Pennylane non connect{'é'}</p>
          <p className="text-text-muted text-xs">{status?.error || 'Aucun token configuré'}</p>
          <button
            onClick={() => setShowConfig(true)}
            className="w-full py-2.5 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-400 font-medium text-xs"
          >
            Configurer le token API
          </button>
        </div>
      )}

      {status?.connected && (
        <button
          onClick={() => setShowConfig(!showConfig)}
          className="text-text-muted text-[11px] underline underline-offset-2"
        >
          {showConfig ? 'Masquer la config' : 'Modifier le token API'}
        </button>
      )}

      {showConfig && (
        <div className="p-4 rounded-2xl bg-card border border-card-border space-y-3">
          <p className="text-text-muted text-xs">Token API Pennylane (Bearer token)</p>
          <input
            type="password"
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            placeholder="Coller le token ici..."
            className="w-full bg-bg border border-card-border rounded-xl px-3 py-2 text-text text-xs font-mono focus:outline-none focus:border-green-mid"
          />
          <div className="flex gap-2">
            <button
              onClick={() => { setShowConfig(false); setTokenInput(''); }}
              className="flex-1 py-2 rounded-xl bg-card border border-card-border text-text-muted text-xs font-medium"
            >
              Annuler
            </button>
            <button
              onClick={handleSaveToken}
              disabled={savingToken || !tokenInput.trim()}
              className="flex-1 py-2 rounded-xl bg-green-mid text-white text-xs font-medium disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {savingToken ? (
                <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                'Sauvegarder'
              )}
            </button>
          </div>
        </div>
      )}

      {/* Bank account selector */}
      {status?.connected && bankAccounts.length > 0 && (
        <div className="p-4 rounded-2xl bg-card border border-card-border space-y-3">
          <p className="text-text-muted text-xs uppercase tracking-widest">Compte bancaire</p>
          <div className="space-y-2">
            {bankAccounts.map(acc => (
              <button
                key={acc.id}
                onClick={() => handleSelectBank(acc.id)}
                className={`w-full p-3 rounded-xl text-left transition-colors ${
                  String(acc.id) === selectedBank
                    ? 'bg-green-mid/20 border border-green-mid/40'
                    : 'bg-bg border border-card-border'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-text text-sm font-medium">{acc.name || acc.label || `Compte #${acc.id}`}</p>
                    <p className="text-text-muted text-[10px]">{acc.iban || acc.account_number || ''} {acc.bank_name || ''}</p>
                  </div>
                  {String(acc.id) === selectedBank && (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-green-400 shrink-0"><polyline points="20 6 9 17 4 12" /></svg>
                  )}
                </div>
              </button>
            ))}
          </div>
          {!selectedBank && (
            <p className="text-amber-400 text-[10px]">S{'é'}lectionnez le compte pro pour filtrer les transactions carte</p>
          )}
        </div>
      )}

      {/* Debug section */}
      {status?.connected && (
        <div className="space-y-2">
          {status.responseKeys && (
            <p className="text-text-dim text-[10px] font-mono">API response keys: {JSON.stringify(status.responseKeys)}</p>
          )}
          <button
            onClick={handleDebug}
            disabled={loadingDebug}
            className="text-text-muted text-[11px] underline underline-offset-2"
          >
            {loadingDebug ? 'Chargement...' : 'Debug: voir la réponse brute API'}
          </button>
          {debugData && (
            <pre className="p-3 rounded-xl bg-card border border-card-border text-[9px] text-text-muted font-mono overflow-x-auto max-h-60 overflow-y-auto whitespace-pre-wrap">
              {JSON.stringify(debugData, null, 2)}
            </pre>
          )}
        </div>
      )}

      {/* Main content - only when connected */}
      {status?.connected && (
        <>
          {/* Tabs */}
          <div className="flex gap-1 bg-card rounded-2xl p-1">
            {[
              { id: 'overview', label: 'Rappro.' },
              { id: 'missing', label: 'Manquants' },
              { id: 'stats', label: 'Stats' },
              { id: 'invoices', label: 'Factures' },
              { id: 'transactions', label: 'Transac.' },
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => handleTabChange(tab.id)}
                className={`flex-1 py-2 rounded-xl text-xs font-medium transition-colors ${
                  activeTab === tab.id
                    ? 'bg-green-mid/20 text-green-light'
                    : 'text-text-muted'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Barre de recherche (filtre l'onglet actif) — sauf Stats qui a ses propres filtres */}
          {activeTab !== 'stats' && (
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-dim text-xs">{'🔍'}</span>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={
                  activeTab === 'missing' ? 'Rechercher : collaborateur, carte, marchand, montant…'
                  : activeTab === 'invoices' ? 'Rechercher : fichier, fournisseur, montant…'
                  : activeTab === 'transactions' ? 'Rechercher : libellé, montant…'
                  : 'Rechercher : marchand, type, montant…'
                }
                className="w-full bg-card border border-card-border rounded-xl pl-8 pr-8 py-2 text-text text-xs focus:outline-none focus:border-green-mid"
              />
              {search && (
                <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted text-xs">{'✕'}</button>
              )}
            </div>
          )}

          {/* Stats tab */}
          {activeTab === 'stats' && <PennylaneStats toast={setToast} />}

          {/* Overview tab */}
          {activeTab === 'overview' && (
            <div className="space-y-4">
              {/* Unmatched count card */}
              <div className="p-5 rounded-3xl bg-card border border-card-border">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <p className="text-text-muted text-xs uppercase tracking-widest">{'A'} rapprocher</p>
                    <p className="font-serif text-3xl font-bold text-text mt-1">{unmatched.length}</p>
                    <p className="text-text-muted text-xs">d{'é'}penses non rapproch{'é'}es</p>
                  </div>
                  <div className="w-14 h-14 rounded-2xl bg-amber-500/10 flex items-center justify-center">
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-amber-400">
                      <path d="M12 2L2 7l10 5 10-5-10-5z" />
                      <path d="M2 17l10 5 10-5" />
                      <path d="M2 12l10 5 10-5" />
                    </svg>
                  </div>
                </div>

                <button
                  onClick={handleReconcile}
                  disabled={reconciling || unmatched.length === 0}
                  className="w-full py-3 rounded-2xl bg-green-mid text-white font-semibold text-sm transition-transform active:scale-[0.97] disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {reconciling ? (
                    <>
                      <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Rapprochement en cours...
                    </>
                  ) : (
                    <>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>
                      Lancer le rapprochement auto
                    </>
                  )}
                </button>
              </div>

              {/* Results */}
              {results && (
                <div className="space-y-3">
                  <h3 className="text-text-muted text-xs uppercase tracking-widest">R{'é'}sultats</h3>

                  {/* Summary */}
                  <div className="grid grid-cols-2 gap-2">
                    <div className="p-3 rounded-xl bg-green-500/5 border border-green-500/20">
                      <p className="text-green-400 text-lg font-bold">{results.summary.matched}</p>
                      <p className="text-text-muted text-[10px]">Rapproch{'é'}(s)</p>
                    </div>
                    {results.summary.alreadyReconciled > 0 && (
                      <div className="p-3 rounded-xl bg-green-500/5 border border-green-500/20">
                        <p className="text-green-300 text-lg font-bold">{results.summary.alreadyReconciled}</p>
                        <p className="text-text-muted text-[10px]">D{'é'}j{'à'} fait dans Pennylane</p>
                      </div>
                    )}
                    <div className="p-3 rounded-xl bg-amber-500/5 border border-amber-500/20">
                      <p className="text-amber-400 text-lg font-bold">{results.summary.noInvoice}</p>
                      <p className="text-text-muted text-[10px]">Sans facture</p>
                    </div>
                    <div className="p-3 rounded-xl bg-blue-500/5 border border-blue-500/20">
                      <p className="text-blue-400 text-lg font-bold">{results.summary.noTransaction}</p>
                      <p className="text-text-muted text-[10px]">Sans transaction</p>
                    </div>
                    <div className="p-3 rounded-xl bg-red-500/5 border border-red-500/20">
                      <p className="text-red-400 text-lg font-bold">{results.summary.errors}</p>
                      <p className="text-text-muted text-[10px]">Erreur(s)</p>
                    </div>
                  </div>

                  {/* Diagnostics */}
                  {results.diagnostics && (
                    <div className="p-3 rounded-xl bg-blue-500/5 border border-blue-500/20 space-y-1">
                      <p className="text-blue-400 text-[10px] font-medium uppercase tracking-widest">Diagnostic</p>
                      <p className="text-text-muted text-[10px]">
                        {results.diagnostics.totalInvoices} factures Pennylane ({results.diagnostics.unreconciledInvoices} non rapproch{'é'}es) en {results.diagnostics.invoicePages} page(s)
                      </p>
                      <p className="text-text-muted text-[10px]">
                        {results.diagnostics.totalTransactions} transactions ({results.diagnostics.expenseTransactions} d{'é'}penses)
                      </p>
                      <p className="text-text-muted text-[10px]">
                        D{'é'}penses avec fichier : {results.diagnostics.expensesWithFileName} / sans : {results.diagnostics.expensesWithoutFileName}
                      </p>
                      {results.diagnostics.sampleInvoices?.length > 0 && (
                        <details className="mt-2">
                          <summary className="text-text-dim text-[10px] cursor-pointer">Exemples de factures Pennylane</summary>
                          <div className="mt-1 space-y-1">
                            {results.diagnostics.sampleInvoices.map(inv => (
                              <p key={inv.id} className="text-text-dim text-[9px] font-mono truncate">
                                {inv.filename || '(pas de filename)'} — {inv.label?.substring(0, 40)} — {Number(inv.amount || 0).toFixed(2)}{'€'} — {inv.date}
                              </p>
                            ))}
                          </div>
                        </details>
                      )}
                    </div>
                  )}

                  {/* Detail list */}
                  <div className="space-y-2">
                    {results.results.filter(r => matchText(r.merchant, r.fileName, r.type, r.userName, Number(r.amount).toFixed(2))).map((r, i) => (
                      <div key={i} className={`p-3 rounded-xl border ${
                        r.status === 'matched' || r.status === 'already_reconciled' ? 'bg-green-500/5 border-green-500/20' :
                        r.status === 'error' ? 'bg-red-500/5 border-red-500/20' :
                        'bg-card border-card-border'
                      }`}>
                        <div className="flex items-center justify-between">
                          <div className="flex-1 min-w-0 mr-2">
                            <p className="text-text text-sm font-medium">{r.merchant || 'Sans commerçant'}</p>
                            <p className="text-text-muted text-xs">
                              {Number(r.amount).toFixed(2)} {'€'} · {new Date(r.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
                            </p>
                            <p className="text-text-dim text-[10px]">
                              {r.userName}{r.cardId ? ` · Carte ${r.cardId}` : ''}
                            </p>
                          </div>
                          <span className={`px-2 py-1 rounded-lg text-[10px] font-medium shrink-0 ${
                            r.status === 'matched' || r.status === 'already_reconciled' ? 'bg-green-500/20 text-green-400' :
                            r.status === 'no_invoice' ? 'bg-amber-500/20 text-amber-400' :
                            r.status === 'no_transaction' ? 'bg-blue-500/20 text-blue-400' :
                            'bg-red-500/20 text-red-400'
                          }`}>
                            {r.status === 'matched' ? 'Rapproché' :
                             r.status === 'already_reconciled' ? 'Déjà fait' :
                             r.status === 'no_invoice' ? 'Pas de facture' :
                             r.status === 'no_transaction' ? 'Pas de transaction' :
                             'Erreur'}
                          </span>
                        </div>
                        {r.message && <p className="text-text-dim text-[10px] mt-1">{r.message}</p>}
                        {r.paymentFound !== undefined && (
                          <p className={`text-[10px] mt-1 ${r.paymentFound ? 'text-green-400' : 'text-amber-400'}`}>
                            {r.paymentFound
                              ? `Paiement trouvé : ${Number(r.paymentInfo.amount).toFixed(2)}€ le ${r.paymentInfo.date} — ${r.paymentInfo.label}`
                              : 'Aucun paiement correspondant sur le compte bancaire'}
                          </p>
                        )}
                        {r.invoiceScore && (
                          <p className="text-text-dim text-[10px] mt-1">
                            Score facture: {r.invoiceScore}{r.transactionScore ? ` · Score transaction: ${r.transactionScore}` : ''}
                          </p>
                        )}
                        {r.bestCandidates?.length > 0 && (
                          <details className="mt-1">
                            <summary className="text-text-dim text-[9px] cursor-pointer">Meilleurs candidats ({r.bestCandidates.length})</summary>
                            <div className="mt-1 space-y-0.5">
                              {r.bestCandidates.map((c, j) => (
                                <p key={j} className="text-text-dim text-[9px] font-mono truncate">
                                  score={c.score} — {c.filename || '(no filename)'} — {Number(c.amount || 0).toFixed(2)}{'€'}
                                </p>
                              ))}
                            </div>
                          </details>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Unmatched expenses list */}
              {unmatched.length > 0 && !results && (
                <div className="space-y-2">
                  <h3 className="text-text-muted text-xs uppercase tracking-widest">D{'é'}penses non rapproch{'é'}es</h3>
                  {unmatched.map(exp => (
                    <div key={exp.id} className="flex items-center gap-3 p-3 rounded-xl bg-card border border-card-border">
                      <div className="flex-1 min-w-0">
                        <p className="text-text text-sm font-medium truncate">{exp.merchant || 'Sans commerçant'}</p>
                        <p className="text-text-muted text-xs">
                          {exp.user?.name} · {new Date(exp.date_ticket).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
                        </p>
                      </div>
                      <p className="font-serif text-sm font-semibold text-text">{Number(exp.amount).toFixed(2)} {'€'}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Missing tab — bank transactions without matching expense */}
          {activeTab === 'missing' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-text-muted text-xs uppercase tracking-widest">Paiements sans ticket — exercice {fyLabel}</h3>
                <button onClick={() => loadMissing({ refresh: true })} className="text-green-light text-xs">Rafra{'î'}chir</button>
              </div>
              {loadingMissing || !missing ? (
                <div className="flex justify-center py-8">
                  <span className="w-6 h-6 border-2 border-green-mid/30 border-t-green-mid rounded-full animate-spin" />
                </div>
              ) : (
                <>
                <div className="p-3 rounded-xl bg-card border border-card-border space-y-1">
                  <div className="flex justify-between items-center">
                    <span className="text-text-muted text-xs">{missing.summary.totalBankTransactions} paiements carte</span>
                    <span className="text-text-muted text-xs">{missing.summary.totalExpenses} tickets dans l'app</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-green-400 text-xs">{missing.summary.matched} retrouv{'é'}s</span>
                    <span className="text-amber-400 text-xs font-medium">{missing.summary.unmatched} sans ticket</span>
                  </div>
                </div>

                {/* Alerte : cartes détectées non encore attribuées à un collaborateur */}
                {(() => {
                  const unassigned = (missing.cards || []).filter(c => c.masked && !c.userId);
                  return unassigned.length > 0 ? (
                    <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-300">
                      {'🆕'} {unassigned.length} carte{unassigned.length > 1 ? 's' : ''} non attribuée{unassigned.length > 1 ? 's' : ''} ({unassigned.map(c => `•••• ${c.last4}`).join(', ')}) — attribue-les à un collaborateur ci-dessous.
                    </div>
                  ) : null;
                })()}

                {/* Tableau de bord par carte : collaborateur + ses paiements sans justificatif */}
                {(!missing.cards || missing.cards.length === 0) ? (
                  <p className="text-green-400 text-center py-8 text-sm">Aucune transaction carte sur la période</p>
                ) : (
                  <div className="space-y-2">
                    <h4 className="text-text-muted text-[11px] uppercase tracking-widest">Par carte · collaborateur</h4>
                    {missing.cards.filter(card => {
                      const collab = users.find(u => u.id === card.userId);
                      const cardTxs = (missing.transactions || []).filter(t => (t.card?.masked || null) === card.masked);
                      return matchText(collab?.name, card.label, card.last4, card.employee)
                        || cardTxs.some(t => matchText(t.label, Number(t.amount).toFixed(2)));
                    }).map(card => {
                      const collab = users.find(u => u.id === card.userId);
                      const key = card.masked || 'unknown';
                      const isOpen = openCard === key;
                      const cardTxs = (missing.transactions || []).filter(t => (t.card?.masked || null) === card.masked);
                      return (
                        <div key={key} className="rounded-xl bg-card border border-card-border overflow-hidden">
                          <div className="p-3">
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex-1 min-w-0">
                                {editingCard === card.masked ? (
                                  <div className="flex items-center gap-2">
                                    <input
                                      autoFocus
                                      value={cardLabelInput}
                                      onChange={(e) => setCardLabelInput(e.target.value)}
                                      onKeyDown={(e) => e.key === 'Enter' && handleSaveCardLabel(card.masked)}
                                      placeholder="Nom de la carte"
                                      className="flex-1 min-w-0 bg-bg border border-card-border rounded-lg px-2 py-1 text-text text-xs focus:outline-none focus:border-green-mid"
                                    />
                                    <button onClick={() => handleSaveCardLabel(card.masked)} disabled={savingCard} className="text-green-light text-xs font-medium shrink-0">{savingCard ? '…' : 'OK'}</button>
                                    <button onClick={() => { setEditingCard(null); setCardLabelInput(''); }} className="text-text-muted text-xs shrink-0">{'✕'}</button>
                                  </div>
                                ) : (
                                  <button
                                    onClick={() => { if (card.masked) { setEditingCard(card.masked); setCardLabelInput(card.label || ''); } }}
                                    className="text-left w-full"
                                    disabled={!card.masked}
                                  >
                                    <p className="text-text text-sm font-medium truncate">
                                      {'👤'} {collab ? collab.name : 'Non attribué'}
                                    </p>
                                    <p className="text-text-muted text-[10px]">
                                      {cardName(card)} {card.masked && <span className="text-text-dim">{'✏️'}</span>} · {card.last4 ? `•••• ${card.last4}` : 'sans carte'}
                                    </p>
                                  </button>
                                )}
                              </div>
                              <button onClick={() => setOpenCard(isOpen ? null : key)} className="text-right shrink-0">
                                <p className={`font-serif text-lg font-semibold ${card.missing > 0 ? 'text-amber-400' : 'text-green-400'}`}>
                                  {card.missing}
                                </p>
                                <p className="text-text-muted text-[10px]">
                                  {card.missing > 0 ? `${Number(card.amountMissing).toFixed(2)}€ ${isOpen ? '▲' : '▼'}` : 'à jour'}
                                </p>
                              </button>
                            </div>

                            {card.masked && (
                              <div className="mt-2 flex items-center gap-2">
                                <span className="text-text-muted text-[10px] shrink-0">Attribuer à</span>
                                <select
                                  value={card.userId || ''}
                                  onChange={(e) => handleAssignCard(card.masked, e.target.value)}
                                  className="flex-1 min-w-0 bg-bg border border-card-border rounded-lg px-2 py-1 text-text text-xs focus:outline-none focus:border-green-mid"
                                >
                                  <option value="">{'— non attribué —'}</option>
                                  {users.map(u => (<option key={u.id} value={u.id}>{u.name}</option>))}
                                </select>
                              </div>
                            )}

                            {card.masked && vehicleOptions.length > 0 && (
                              <div className="mt-2 flex items-center gap-2">
                                <span className="text-text-muted text-[10px] shrink-0">{'🚐'} Véhicule</span>
                                <select
                                  value={cardVehicles[card.masked] || ''}
                                  onChange={(e) => handleAssignVehicle(card.masked, e.target.value)}
                                  className="flex-1 min-w-0 bg-bg border border-card-border rounded-lg px-2 py-1 text-text text-xs focus:outline-none focus:border-green-mid"
                                >
                                  <option value="">{'— aucun —'}</option>
                                  {vehicleOptions.map(v => (<option key={v.id} value={v.id}>{v.label}</option>))}
                                </select>
                              </div>
                            )}
                          </div>

                          {isOpen && card.missing > 0 && (
                            <div className="border-t border-card-border divide-y divide-card-border/40">
                              {cardTxs.map(tx => {
                                const params = `amount=${encodeURIComponent(Number(tx.amount).toFixed(2))}&date=${encodeURIComponent(tx.date)}&merchant=${encodeURIComponent(tx.label || '')}`;
                                return (
                                  <div key={tx.transactionId} className="px-3 py-2.5">
                                    <div className="flex items-center justify-between gap-2">
                                      <div className="min-w-0">
                                        <p className="text-text text-xs font-medium truncate">{tx.label || 'Transaction'}</p>
                                        <p className="text-text-muted text-[10px]">{new Date(tx.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}</p>
                                      </div>
                                      <p className="font-serif text-sm font-semibold text-amber-400 shrink-0">-{Number(tx.amount).toFixed(2)}{'€'}</p>
                                    </div>
                                    <div className="flex gap-2 mt-1.5">
                                      <Link to={`/?${params}`} className="flex-1 text-center py-1 rounded-lg bg-green-mid/20 text-green-light text-[10px] font-medium">{'📷'} Scanner</Link>
                                      <Link to={`/manual?${params}`} className="flex-1 text-center py-1 rounded-lg bg-bg border border-card-border text-text-muted text-[10px] font-medium">{'✍️'} Saisie</Link>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
                </>
              )}
            </div>
          )}

          {/* Invoices tab */}
          {activeTab === 'invoices' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-text-muted text-xs uppercase tracking-widest">Factures fournisseur — exercice {fyLabel}</h3>
                <button onClick={loadInvoices} className="text-green-light text-xs">Rafra{'î'}chir</button>
              </div>
              {!invoices ? (
                <div className="flex justify-center py-8">
                  <span className="w-6 h-6 border-2 border-green-mid/30 border-t-green-mid rounded-full animate-spin" />
                </div>
              ) : (
                <>
                <p className="text-text-dim text-[10px]">{(invoices.items || []).length} factures</p>
                <div className="space-y-2">
                  {(invoices.items || []).filter(inv => matchText(inv.filename, inv.label, inv.invoice_number, inv.supplier?.name, Number(inv.currency_amount || inv.amount || 0).toFixed(2))).map(inv => (
                    <button
                      key={inv.id}
                      onClick={() => handleViewInvoice(inv.id)}
                      className="w-full p-3 rounded-xl bg-card border border-card-border text-left active:scale-[0.98] transition-transform"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex-1 min-w-0 mr-3">
                          <p className="text-text text-sm font-medium truncate">{inv.filename || inv.label || `Facture #${inv.id}`}</p>
                          <p className="text-text-muted text-xs">
                            {inv.date} · {inv.payment_status || 'N/A'}
                          </p>
                          {inv.label && inv.filename && (
                            <p className="text-text-dim text-[10px] truncate mt-0.5">{inv.label}</p>
                          )}
                        </div>
                        <div className="text-right shrink-0 flex items-center gap-2">
                          <div>
                            <p className="font-serif text-sm font-semibold text-text">
                              {Number(inv.currency_amount || inv.amount || 0).toFixed(2)} {'€'}
                            </p>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                              inv.reconciled ? 'bg-green-500/20 text-green-400' :
                              inv.accounting_status === 'validation_needed' ? 'bg-amber-500/20 text-amber-400' :
                              'bg-blue-500/20 text-blue-400'
                            }`}>
                              {inv.reconciled ? 'Rapproché' : inv.accounting_status || '?'}
                            </span>
                          </div>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-text-muted shrink-0"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></svg>
                        </div>
                      </div>
                    </button>
                  ))}
                  {(invoices.items || []).length === 0 && (
                    <p className="text-text-dim text-center py-8 text-sm">Aucune facture</p>
                  )}
                </div>
                </>
              )}
            </div>
          )}

          {/* Transactions tab */}
          {activeTab === 'transactions' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-text-muted text-xs uppercase tracking-widest">D{'é'}penses carte — exercice {fyLabel}</h3>
                <button onClick={loadTransactions} className="text-green-light text-xs">Rafra{'î'}chir</button>
              </div>
              {!transactions ? (
                <div className="flex justify-center py-8">
                  <span className="w-6 h-6 border-2 border-green-mid/30 border-t-green-mid rounded-full animate-spin" />
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="p-3 rounded-xl bg-card border border-card-border flex justify-between items-center">
                    <span className="text-text-muted text-xs">{(transactions.items || []).length} d{'é'}penses carte</span>
                    <span className="font-serif text-sm font-semibold text-red-400">
                      {(transactions.items || []).reduce((sum, t) => sum + Number(t.amount), 0).toFixed(2)} {'€'}
                    </span>
                  </div>
                  {(transactions.items || []).filter(tx => matchText(tx.label, Number(tx.amount).toFixed(2))).map(tx => (
                    <div key={tx.id} className="p-3 rounded-xl bg-card border border-card-border">
                      <div className="flex items-center justify-between">
                        <div className="flex-1 min-w-0 mr-3">
                          <p className="text-text text-sm font-medium truncate">{tx.label || `Transaction #${tx.id}`}</p>
                          <p className="text-text-muted text-xs">{tx.date}</p>
                        </div>
                        <p className="font-serif text-sm font-semibold text-red-400 shrink-0">
                          {Number(tx.amount).toFixed(2)} {'€'}
                        </p>
                      </div>
                    </div>
                  ))}
                  {(transactions.items || []).length === 0 && (
                    <p className="text-text-dim text-center py-8 text-sm">Aucune d{'é'}pense carte</p>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
