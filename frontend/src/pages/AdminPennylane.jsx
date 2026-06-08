import React, { useEffect, useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../utils/api';
import Toast from '../components/Toast';

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
      const { matched, noInvoice, noTransaction, errors } = data.summary;
      setToast({
        message: `Rapprochement terminé : ${matched} rapproché(s), ${noInvoice + noTransaction} sans match, ${errors} erreur(s)`,
        type: matched > 0 ? 'success' : 'warning',
      });
      const u = await api.getPennylaneUnmatched().catch(() => ({ expenses: [] }));
      setUnmatched(u.expenses || []);
    } catch (err) {
      setToast({ message: err.message, type: 'error' });
    } finally {
      setReconciling(false);
    }
  }

  async function loadInvoices() {
    try {
      const data = await api.getPennylaneInvoices({ limit: 20 });
      setInvoices(data);
    } catch (err) {
      setToast({ message: 'Erreur chargement factures: ' + err.message, type: 'error' });
    }
  }

  async function loadTransactions() {
    try {
      const now = new Date();
      const from = new Date(now);
      from.setDate(from.getDate() - 30);
      const data = await api.getPennylaneTransactions({
        date_from: from.toISOString().slice(0, 10),
        date_to: now.toISOString().slice(0, 10),
        limit: 20,
      });
      setTransactions(data);
    } catch (err) {
      setToast({ message: 'Erreur chargement transactions: ' + err.message, type: 'error' });
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

  function handleTabChange(tab) {
    setActiveTab(tab);
    if (tab === 'invoices' && !invoices) loadInvoices();
    if (tab === 'transactions' && !transactions) loadTransactions();
  }

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
              { id: 'overview', label: 'Rapprochement' },
              { id: 'invoices', label: 'Factures' },
              { id: 'transactions', label: 'Transactions' },
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

                  {/* Detail list */}
                  <div className="space-y-2">
                    {results.results.map((r, i) => (
                      <div key={i} className={`p-3 rounded-xl border ${
                        r.status === 'matched' ? 'bg-green-500/5 border-green-500/20' :
                        r.status === 'error' ? 'bg-red-500/5 border-red-500/20' :
                        'bg-card border-card-border'
                      }`}>
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-text text-sm font-medium">{r.merchant || 'Sans commerçant'}</p>
                            <p className="text-text-muted text-xs">
                              {Number(r.amount).toFixed(2)} {'€'} · {new Date(r.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
                            </p>
                          </div>
                          <span className={`px-2 py-1 rounded-lg text-[10px] font-medium ${
                            r.status === 'matched' ? 'bg-green-500/20 text-green-400' :
                            r.status === 'no_invoice' ? 'bg-amber-500/20 text-amber-400' :
                            r.status === 'no_transaction' ? 'bg-blue-500/20 text-blue-400' :
                            'bg-red-500/20 text-red-400'
                          }`}>
                            {r.status === 'matched' ? 'Rapproché' :
                             r.status === 'no_invoice' ? 'Pas de facture' :
                             r.status === 'no_transaction' ? 'Pas de transaction' :
                             'Erreur'}
                          </span>
                        </div>
                        {r.message && <p className="text-text-dim text-[10px] mt-1">{r.message}</p>}
                        {r.invoiceScore && (
                          <p className="text-text-dim text-[10px] mt-1">
                            Score facture: {r.invoiceScore}{r.transactionScore ? ` · Score transaction: ${r.transactionScore}` : ''}
                          </p>
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

          {/* Invoices tab */}
          {activeTab === 'invoices' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-text-muted text-xs uppercase tracking-widest">Factures fournisseur Pennylane</h3>
                <button onClick={loadInvoices} className="text-green-light text-xs">Rafra{'î'}chir</button>
              </div>
              {!invoices ? (
                <div className="flex justify-center py-8">
                  <span className="w-6 h-6 border-2 border-green-mid/30 border-t-green-mid rounded-full animate-spin" />
                </div>
              ) : (
                <div className="space-y-2">
                  {(invoices.items || []).map(inv => (
                    <div key={inv.id} className="p-3 rounded-xl bg-card border border-card-border">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-text text-sm font-medium">{inv.supplier?.name || `Facture #${inv.id}`}</p>
                          <p className="text-text-muted text-xs">
                            {inv.date} · {inv.invoice_number || 'N/A'}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="font-serif text-sm font-semibold text-text">
                            {Number(inv.currency_amount || inv.amount || 0).toFixed(2)} {'€'}
                          </p>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                            inv.status === 'draft' ? 'bg-amber-500/20 text-amber-400' :
                            inv.status === 'paid' ? 'bg-green-500/20 text-green-400' :
                            'bg-blue-500/20 text-blue-400'
                          }`}>
                            {inv.status}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                  {(invoices.items || []).length === 0 && (
                    <p className="text-text-dim text-center py-8 text-sm">Aucune facture</p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Transactions tab */}
          {activeTab === 'transactions' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-text-muted text-xs uppercase tracking-widest">Transactions bancaires (30j)</h3>
                <button onClick={loadTransactions} className="text-green-light text-xs">Rafra{'î'}chir</button>
              </div>
              {!transactions ? (
                <div className="flex justify-center py-8">
                  <span className="w-6 h-6 border-2 border-green-mid/30 border-t-green-mid rounded-full animate-spin" />
                </div>
              ) : (
                <div className="space-y-2">
                  {(transactions.items || []).map(tx => (
                    <div key={tx.id} className="p-3 rounded-xl bg-card border border-card-border">
                      <div className="flex items-center justify-between">
                        <div className="flex-1 min-w-0">
                          <p className="text-text text-sm font-medium truncate">{tx.label || `Transaction #${tx.id}`}</p>
                          <p className="text-text-muted text-xs">{tx.date}</p>
                        </div>
                        <p className={`font-serif text-sm font-semibold ${Number(tx.amount) < 0 ? 'text-red-400' : 'text-green-400'}`}>
                          {Number(tx.amount).toFixed(2)} {'€'}
                        </p>
                      </div>
                    </div>
                  ))}
                  {(transactions.items || []).length === 0 && (
                    <p className="text-text-dim text-center py-8 text-sm">Aucune transaction</p>
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
