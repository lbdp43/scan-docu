import React, { useEffect, useState, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useExpenseTypes } from '../context/ExpenseTypesContext';
import { api } from '../utils/api';
import Toast from '../components/Toast';
import EditExpenseModal from '../components/EditExpenseModal';
import TypeIcon from '../components/TypeIcon';

const CACHE_KEY = 'admin_v1';
const CACHE_TTL = 2 * 60 * 1000;

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const { data, ts } = JSON.parse(raw);
    return Date.now() - ts < CACHE_TTL ? data : null;
  } catch { return null; }
}

function writeCache(data) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ data, ts: Date.now() }));
  } catch {}
}

export default function Admin() {
  const { user } = useAuth();
  const { types: expenseTypes, typesMap: TYPE_ICONS } = useExpenseTypes();
  const [searchParams, setSearchParams] = useSearchParams();
  const cached = readCache();
  const [stats, setStats] = useState(cached?.stats ?? null);
  const [expenses, setExpenses] = useState(cached?.expenses ?? []);
  const [loading, setLoading] = useState(!cached);
  const loadedRef = useRef(false);
  const [toast, setToast] = useState(null);
  const [filterUser, setFilterUser] = useState('');
  const [filterType, setFilterType] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [retryingAll, setRetryingAll] = useState(false);
  const [exportingFailed, setExportingFailed] = useState(false);
  const [driveStatus, setDriveStatus] = useState(null);
  const [zipDownloaded, setZipDownloaded] = useState(false);
  const [acknowledging, setAcknowledging] = useState(false);
  const [editingExpense, setEditingExpense] = useState(null);
  const [reconnecting, setReconnecting] = useState(false);
  const [showPasteToken, setShowPasteToken] = useState(false);
  const [pastedToken, setPastedToken] = useState('');
  const [savingToken, setSavingToken] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const [redirectUri, setRedirectUri] = useState('');
  const [creatingFolder, setCreatingFolder] = useState(false);

  // Handle OAuth redirect params
  useEffect(() => {
    const driveResult = searchParams.get('drive');
    if (driveResult) {
      if (driveResult === 'success') {
        setToast({ message: 'Google Drive reconnecté avec succès', type: 'success' });
        api.getDriveStatus().then(setDriveStatus).catch(() => {});
      } else if (driveResult === 'no_token') {
        setToast({ message: searchParams.get('msg') || 'Pas de token reçu — révoquez l\'accès puis réessayez', type: 'error' });
      } else if (driveResult === 'error') {
        setToast({ message: searchParams.get('msg') || 'Erreur de connexion Drive', type: 'error' });
      }
      setSearchParams({}, { replace: true });
    }
  }, []);

  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    loadData();
  }, []);

  useEffect(() => {
    if (!loadedRef.current) return;
    loadExpenses();
  }, [filterUser, filterType]);

  async function loadData() {
    try {
      const [statsData, expensesData] = await Promise.all([
        api.getAdminStats(),
        api.getAdminExpenses({}),
      ]);
      setStats(statsData);
      setExpenses(expensesData.expenses);
      writeCache({ stats: statsData, expenses: expensesData.expenses });
    } catch (err) {
      console.error('Admin load error:', err);
    } finally {
      setLoading(false);
    }
    api.getDriveStatus().then(setDriveStatus).catch(() => {});
  }

  async function handleReconnectDrive() {
    setReconnecting(true);
    try {
      const { url } = await api.getDriveAuthUrl();
      window.location.href = url;
    } catch (err) {
      setToast({ message: err.message || 'Erreur', type: 'error' });
      setReconnecting(false);
    }
  }

  async function handleShowSetup() {
    setShowSetup(!showSetup);
    if (!redirectUri) {
      try {
        const { redirectUri: uri } = await api.getDriveRedirectUri();
        setRedirectUri(uri);
      } catch {}
    }
  }

  async function handleSaveToken() {
    if (!pastedToken.trim()) return;
    setSavingToken(true);
    try {
      const result = await api.setDriveToken(pastedToken.trim());
      setToast({ message: `Drive reconnecté (${result.email || 'OK'})`, type: 'success' });
      setShowPasteToken(false);
      setPastedToken('');
      api.getDriveStatus().then(setDriveStatus).catch(() => {});
    } catch (err) {
      setToast({ message: err.message || 'Token invalide', type: 'error' });
    } finally {
      setSavingToken(false);
    }
  }

  async function handleCreateFolder() {
    setCreatingFolder(true);
    try {
      const result = await api.createDriveFolder('LBDP Notes de Frais');
      setToast({ message: `Dossier « ${result.name} » créé sur Drive`, type: 'success' });
      api.getDriveStatus().then(setDriveStatus).catch(() => {});
    } catch (err) {
      setToast({ message: err.message || 'Erreur lors de la création du dossier', type: 'error' });
    } finally {
      setCreatingFolder(false);
    }
  }

  async function loadExpenses() {
    try {
      const params = {};
      if (filterUser) params.user_id = filterUser;
      if (filterType) params.type = filterType;
      const data = await api.getAdminExpenses(params);
      setExpenses(data.expenses);
    } catch (err) {
      console.error(err);
    }
  }

  async function handleDelete(expenseId) {
    try {
      await api.deleteExpense(expenseId);
      setDeleteConfirm(null);
      setToast({ message: 'Dépense supprimée', type: 'success' });
      await loadExpenses();
      // Refresh stats too
      const statsData = await api.getAdminStats();
      setStats(statsData);
    } catch (err) {
      setToast({ message: err.message || 'Erreur lors de la suppression', type: 'error' });
    }
  }

  async function handleRetryAll() {
    setRetryingAll(true);
    try {
      const result = await api.retryAllDriveUploads();
      const { uploaded, failed } = result.summary || {};
      setToast({
        message: `Retry termin\u00E9 : ${uploaded || 0} envoy\u00E9(s), ${failed || 0} \u00E9chec(s)`,
        type: uploaded > 0 ? 'success' : 'error',
      });
      await loadExpenses();
      const statsData = await api.getAdminStats();
      setStats(statsData);
    } catch (err) {
      setToast({ message: err.message || 'Erreur lors du retry', type: 'error' });
    } finally {
      setRetryingAll(false);
    }
  }

  async function handleExportFailed() {
    setExportingFailed(true);
    try {
      const blob = await api.exportFailedReceipts();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `justificatifs-echec-drive-${new Date().toISOString().slice(0, 10)}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      setZipDownloaded(true);
      setToast({ message: 'Export ZIP t\u00E9l\u00E9charg\u00E9 — confirmez la r\u00E9ception ci-dessous', type: 'success' });
    } catch (err) {
      setToast({ message: err.message || 'Erreur export', type: 'error' });
    } finally {
      setExportingFailed(false);
    }
  }

  async function handleAcknowledgeZip() {
    setAcknowledging(true);
    try {
      const result = await api.acknowledgeZipDownload();
      setZipDownloaded(false);
      setToast({
        message: `${result.count} justificatif(s) valid\u00E9(s) — alerte effac\u00E9e`,
        type: 'success',
      });
      await loadExpenses();
      const statsData = await api.getAdminStats();
      setStats(statsData);
    } catch (err) {
      setToast({ message: err.message || 'Erreur lors de la validation', type: 'error' });
    } finally {
      setAcknowledging(false);
    }
  }

  async function handleExportCSV() {
    try {
      const blob = await api.exportCSV({});
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `notes-de-frais-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      setToast({ message: 'Export CSV téléchargé', type: 'success' });
    } catch (err) {
      setToast({ message: 'Erreur export CSV', type: 'error' });
    }
  }

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="flex items-center justify-between">
          <div className="h-7 bg-card rounded-xl w-40" />
          <div className="h-7 bg-card rounded-full w-24" />
        </div>
        <div className="rounded-4xl p-7 bg-card h-40" />
        <div className="grid grid-cols-2 gap-3">
          {[1,2,3,4].map(i => <div key={i} className="h-24 bg-card rounded-2xl" />)}
        </div>
        <div className="space-y-2">
          {[1,2,3].map(i => <div key={i} className="h-16 bg-card rounded-2xl" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-up">
      {toast && <Toast {...toast} onClose={() => setToast(null)} />}

      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="font-serif text-xl font-semibold">Administration</h1>
        <span className="px-3 py-1 rounded-full text-xs font-medium bg-gold/10 border border-gold/30 text-gold">
          Admin {user?.name?.split(' ')[0]}
        </span>
      </div>

      {/* Drive status alert */}
      {driveStatus && !driveStatus.connected && (
        <div className="p-4 rounded-2xl bg-red-500/5 border border-red-500/20 space-y-3">
          <div className="flex items-center gap-2">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-red-400 shrink-0"><circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" /></svg>
            <p className="text-red-400 text-sm font-medium">Google Drive d{'é'}connect{'é'}</p>
          </div>
          <p className="text-text-muted text-xs">{driveStatus.error}</p>
          <div className="text-text-dim text-[10px] space-y-0.5">
            <p>Client ID : {driveStatus.details?.hasClientId ? 'OK' : 'Manquant'}</p>
            <p>Client Secret : {driveStatus.details?.hasClientSecret ? 'OK' : 'Manquant'}</p>
            <p>Refresh Token : {driveStatus.details?.hasRefreshToken ? 'OK' : 'Manquant'}</p>
            <p>Folder ID : {driveStatus.details?.hasFolderId ? driveStatus.details.folderId : 'Manquant'}</p>
          </div>
          <button
            onClick={handleReconnectDrive}
            disabled={reconnecting}
            className="w-full py-2.5 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-400 font-medium text-xs transition-transform active:scale-[0.97] disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {reconnecting ? (
              <>
                <span className="w-3.5 h-3.5 border-2 border-blue-400/30 border-t-blue-400 rounded-full animate-spin" />
                Redirection vers Google...
              </>
            ) : (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 4v6h6" /><path d="M3.51 15a9 9 0 100-6.36L1 10" /></svg>
                Reconnecter Google Drive
              </>
            )}
          </button>

          {/* One-time setup helper for the reconnect button */}
          <button
            onClick={handleShowSetup}
            className="w-full text-text-muted text-[11px] underline underline-offset-2 hover:text-text"
          >
            {showSetup ? 'Masquer' : 'Le bouton ne marche pas ? Configurer (1 fois)'}
          </button>
          {showSetup && (
            <div className="space-y-2 p-3 rounded-xl bg-bg/50 border border-card-border">
              <p className="text-text-muted text-[10px] leading-relaxed">
                Pour que le bouton fonctionne en un clic, ajoutez cette URL aux <strong className="text-text">URI de redirection autoris{'é'}s</strong> de votre client OAuth dans Google&nbsp;Console&nbsp;:
              </p>
              <div className="flex gap-2 items-center">
                <code className="flex-1 bg-bg border border-card-border rounded-lg px-2 py-1.5 text-[10px] text-green-light font-mono break-all">
                  {redirectUri || 'Chargement...'}
                </code>
                {redirectUri && (
                  <button
                    onClick={() => { navigator.clipboard?.writeText(redirectUri); setToast({ message: 'URL copiée', type: 'success' }); }}
                    className="shrink-0 px-2 py-1.5 rounded-lg bg-card border border-card-border text-text-muted text-[10px]"
                  >
                    Copier
                  </button>
                )}
              </div>
              <a
                href="https://console.cloud.google.com/apis/credentials"
                target="_blank"
                rel="noopener noreferrer"
                className="block text-blue-400 text-[10px] underline underline-offset-2"
              >
                Ouvrir Google Console → Identifiants
              </a>
              <p className="text-text-dim text-[9px] leading-relaxed">
                Identifiants → votre client OAuth 2.0 → « URI de redirection autoris{'é'}s » → Ajouter → coller l'URL → Enregistrer. Ensuite le bouton « Reconnecter » fonctionnera directement.
              </p>
            </div>
          )}

          {/* Paste token fallback */}
          {!showPasteToken ? (
            <button
              onClick={() => setShowPasteToken(true)}
              className="w-full text-text-muted text-[11px] underline underline-offset-2 hover:text-text"
            >
              Ou coller un refresh token manuellement
            </button>
          ) : (
            <div className="space-y-2 pt-1">
              <p className="text-text-muted text-[10px] leading-relaxed">
                Collez un <strong className="text-text">refresh token</strong> obtenu via le OAuth Playground (avec vos propres identifiants OAuth). Il sera validé puis sauvegardé.
              </p>
              <input
                type="text"
                value={pastedToken}
                onChange={(e) => setPastedToken(e.target.value)}
                placeholder="1//0g..."
                className="w-full bg-bg border border-card-border rounded-xl px-3 py-2 text-text text-xs font-mono focus:outline-none focus:border-green-mid"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => { setShowPasteToken(false); setPastedToken(''); }}
                  className="flex-1 py-2 rounded-xl bg-card border border-card-border text-text-muted text-xs font-medium"
                >
                  Annuler
                </button>
                <button
                  onClick={handleSaveToken}
                  disabled={savingToken || !pastedToken.trim()}
                  className="flex-1 py-2 rounded-xl bg-green-mid text-white text-xs font-medium disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {savingToken ? (
                    <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    'Valider et sauvegarder'
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      {driveStatus && driveStatus.connected && !driveStatus.folderAccessible && (
        <div className="p-4 rounded-2xl bg-amber-500/5 border border-amber-500/20 space-y-3">
          <div className="flex items-center gap-2">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-400 shrink-0"><circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" /></svg>
            <p className="text-amber-400 text-sm font-medium">Drive connect{'é'} ({driveStatus.details?.driveEmail}) mais dossier inaccessible</p>
          </div>
          <p className="text-text-muted text-xs">{driveStatus.error}</p>
          <button
            onClick={handleCreateFolder}
            disabled={creatingFolder}
            className="w-full py-2.5 rounded-xl bg-green-mid/20 border border-green-mid/30 text-green-light font-medium text-xs transition-transform active:scale-[0.97] disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {creatingFolder ? (
              <>
                <span className="w-3.5 h-3.5 border-2 border-green-400/30 border-t-green-400 rounded-full animate-spin" />
                Création du dossier...
              </>
            ) : (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" /><line x1="12" y1="11" x2="12" y2="17" /><line x1="9" y1="14" x2="15" y2="14" /></svg>
                Créer le dossier sur Drive
              </>
            )}
          </button>
          <p className="text-text-dim text-[10px] leading-relaxed">
            L'app crée un dossier « LBDP Notes de Frais » dans votre Drive et y enverra tous les justificatifs. Aucune configuration suppl{'é'}mentaire requise.
          </p>
        </div>
      )}

      {/* Stats hero */}
      <div className="relative overflow-hidden rounded-4xl p-7"
        style={{ background: 'linear-gradient(135deg, #1C3A1E, #243F26)' }}>
        <div className="relative z-10">
          <p className="text-text-muted text-sm mb-1">Total équipe — ce mois</p>
          <p className="font-serif text-[38px] font-bold text-green-light leading-tight">
            {stats?.month?.total ? Number(stats.month.total).toFixed(2) : '0.00'}
            <span className="text-xl ml-1">€</span>
          </p>
          <p className="text-text-muted text-sm mt-1">
            {stats?.month?.count || 0} justificatifs · {stats?.totals?.users || 0} collaborateurs
          </p>
        </div>
        <div className="absolute top-4 right-4 opacity-[0.06] select-none">
          <svg width="70" height="70" viewBox="0 0 24 24" fill="currentColor" className="text-green-light"><path d="M17 8C8 10 5.9 16.17 3.82 21.34l1.89.66.95-2.71c.75.75 1.6 1.34 2.51 1.76C13.18 23.14 19 22 22 18c.91-1.22 1.38-2.66 1-4-.38-1.34-2.07-2-4-2-1.59 0-3.19.5-4.53 1.4-.52-.98-.84-2.09-.97-3.4z"/></svg>
        </div>
      </div>

      {/* Stats by type */}
      <div className="grid grid-cols-2 gap-3">
        {stats?.byType?.map(t => {
          const typeInfo = TYPE_ICONS[t.type] || TYPE_ICONS.autre;
          return (
            <div key={t.type} className="p-4 rounded-2xl bg-card border border-card-border">
              <div className="flex items-center gap-2 mb-2">
                <span style={{ color: typeInfo.hexColor }}><TypeIcon icon={typeInfo.icon} color={typeInfo.hexColor} size={20} /></span>
                <span className="text-text-muted text-xs capitalize">{t.type}</span>
              </div>
              <p className="font-serif text-lg font-semibold text-text">
                {Number(t.total).toFixed(2)} €
              </p>
              <p className="text-text-muted text-xs">{t.count} tickets</p>
            </div>
          );
        })}
      </div>

      {/* Collaborators */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-text-muted text-xs uppercase tracking-widest">Collaborateurs ce mois</h2>
          <Link to="/admin/users" className="text-green-light text-xs font-medium">
            Gérer →
          </Link>
        </div>
        <div className="space-y-2">
          {stats?.byUser?.map(u => (
            <div key={u.userId} className="flex items-center gap-3 p-3 rounded-2xl bg-card border border-card-border">
              <div className="w-10 h-10 rounded-full bg-green-mid/20 flex items-center justify-center text-sm font-semibold text-green-light">
                {u.name?.[0] || '?'}
              </div>
              <div className="flex-1">
                <p className="text-text text-sm font-medium">{u.name}</p>
                <p className="text-text-muted text-xs">{u.card_id || 'Pas de carte'} · {u.count} tickets</p>
              </div>
              <p className="font-serif text-base font-semibold text-green-light">
                {Number(u.total).toFixed(2)} €
              </p>
            </div>
          ))}
          {(!stats?.byUser || stats.byUser.length === 0) && (
            <p className="text-text-dim text-center py-4 text-sm">Aucune dépense ce mois</p>
          )}
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex gap-3">
        <button
          onClick={handleExportCSV}
          className="flex-1 py-3 rounded-2xl bg-gold/10 border border-gold/30 text-gold font-medium text-sm transition-transform active:scale-[0.97]"
        >
          Export CSV
        </button>
        <Link
          to="/admin/types"
          className="flex-1 py-3 rounded-2xl bg-blue-500/10 border border-blue-500/30 text-blue-400 font-medium text-sm text-center transition-transform active:scale-[0.97]"
        >
          Types
        </Link>
        <Link
          to="/"
          className="flex-1 py-3 rounded-2xl bg-green-mid text-white font-medium text-sm text-center transition-transform active:scale-[0.97]"
        >
          Scanner
        </Link>
      </div>

      {/* Drive error management */}
      {expenses.some(e => e.upload_status === 'error') && (
        <div className="p-4 rounded-2xl bg-amber-500/5 border border-amber-500/20 space-y-3">
          <div className="flex items-center gap-2">
            <p className="text-amber-400 text-sm font-medium">
              {expenses.filter(e => e.upload_status === 'error').length} justificatif(s) non envoy{'\u00E9'}(s) sur Drive
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleRetryAll}
              disabled={retryingAll}
              className="flex-1 py-2.5 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-400 font-medium text-xs transition-transform active:scale-[0.97] disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {retryingAll ? (
                <>
                  <span className="w-3.5 h-3.5 border-2 border-blue-400/30 border-t-blue-400 rounded-full animate-spin" />
                  Renvoi en cours...
                </>
              ) : (
                <>Renvoyer tout sur Drive</>
              )}
            </button>
            <button
              onClick={handleExportFailed}
              disabled={exportingFailed}
              className="flex-1 py-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 font-medium text-xs transition-transform active:scale-[0.97] disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {exportingFailed ? (
                <>
                  <span className="w-3.5 h-3.5 border-2 border-amber-400/30 border-t-amber-400 rounded-full animate-spin" />
                  Export...
                </>
              ) : (
                <>T{'\u00E9'}l{'\u00E9'}charger le ZIP</>
              )}
            </button>
          </div>
          {zipDownloaded && (
            <button
              onClick={handleAcknowledgeZip}
              disabled={acknowledging}
              className="w-full py-2.5 rounded-xl bg-green-mid/20 border border-green-mid/30 text-green-light font-medium text-xs transition-transform active:scale-[0.97] disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {acknowledging ? (
                <>
                  <span className="w-3.5 h-3.5 border-2 border-green-400/30 border-t-green-400 rounded-full animate-spin" />
                  Validation...
                </>
              ) : (
                <>J'ai bien t{'\u00E9'}l{'\u00E9'}charg{'\u00E9'} le ZIP — valider</>
              )}
            </button>
          )}
          <p className="text-text-dim text-[10px]">
            Le ZIP contient les photos + PDFs pour les mettre manuellement sur Drive si besoin.
          </p>
        </div>
      )}

      {/* Recent expenses (all users) */}
      <div>
        <h2 className="text-text-muted text-xs uppercase tracking-widest mb-3">Dernières dépenses</h2>

        {/* Filters */}
        <div className="flex gap-2 mb-3 overflow-x-auto pb-1">
          <button
            onClick={() => setFilterType('')}
            className={`px-3 py-1 rounded-full text-xs whitespace-nowrap ${!filterType ? 'bg-green-mid/20 text-green-light' : 'bg-card text-text-muted'}`}
          >
            Tous
          </button>
          {expenseTypes.map((t) => (
            <button
              key={t.value}
              onClick={() => setFilterType(t.value === filterType ? '' : t.value)}
              className={`px-3 py-1 rounded-full text-xs whitespace-nowrap ${filterType === t.value ? 'bg-green-mid/20 text-green-light' : 'bg-card text-text-muted'}`}
            >
              <TypeIcon icon={t.icon} color={t.color} size={14} /> {t.label}
            </button>
          ))}
        </div>

        <div className="space-y-2">
          {expenses.slice(0, 20).map(expense => {
            const typeInfo = TYPE_ICONS[expense.type] || TYPE_ICONS.autre;
            const date = new Date(expense.date_ticket).toLocaleDateString('fr-FR', {
              day: 'numeric', month: 'short',
            });
            return (
              <div
                key={expense.id}
                onClick={() => setEditingExpense(expense)}
                className="flex items-center gap-3 p-3 rounded-2xl bg-card border border-card-border cursor-pointer transition-colors hover:border-green-mid/40 active:scale-[0.99]"
              >
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${typeInfo.color}`}>
                  {expense.has_receipt ? (
                    <TypeIcon icon={typeInfo.icon} color={typeInfo.hexColor} size={20} />
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-text text-sm font-medium truncate">
                      {expense.merchant || 'Sans commer\u00E7ant'}
                    </p>
                    {!expense.has_receipt && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 whitespace-nowrap">
                        Sans ticket
                      </span>
                    )}
                  </div>
                  <p className="text-text-muted text-xs">{expense.user?.name} · {date}</p>
                </div>
                <p className="font-serif text-base font-semibold text-text shrink-0 mr-1">
                  {Number(expense.amount).toFixed(2)}\u20AC
                </p>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setDeleteConfirm(expense); }}
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-red-400/60 hover:text-red-400 hover:bg-red-500/10 transition-colors shrink-0"
                  title="Supprimer"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" /><line x1="10" y1="11" x2="10" y2="17" /><line x1="14" y1="11" x2="14" y2="17" />
                  </svg>
                </button>
              </div>
            );
          })}
          {expenses.length === 0 && (
            <p className="text-text-dim text-center py-8 text-sm">Aucune dépense</p>
          )}
        </div>
      </div>
      {/* Delete confirmation modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-[#1a2a1c] border border-card-border rounded-3xl p-6 max-w-sm w-full space-y-4">
            <h3 className="font-serif text-lg font-semibold text-text">Supprimer cette dépense ?</h3>
            <div className="p-3 rounded-xl bg-card border border-card-border">
              <p className="text-text text-sm font-medium">{deleteConfirm.merchant || 'Sans commerçant'}</p>
              <p className="text-text-muted text-xs">
                {deleteConfirm.user?.name} · {Number(deleteConfirm.amount).toFixed(2)} € · {new Date(deleteConfirm.date_ticket).toLocaleDateString('fr-FR')}
              </p>
            </div>
            <p className="text-red-400/80 text-xs">Cette action est irréversible.</p>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="flex-1 py-3 rounded-2xl bg-card border border-card-border text-text-muted font-medium text-sm transition-transform active:scale-[0.97]"
              >
                Annuler
              </button>
              <button
                onClick={() => handleDelete(deleteConfirm.id)}
                className="flex-1 py-3 rounded-2xl bg-red-500/20 border border-red-500/30 text-red-400 font-medium text-sm transition-transform active:scale-[0.97]"
              >
                Supprimer
              </button>
            </div>
          </div>
        </div>
      )}

      <EditExpenseModal
        expense={editingExpense}
        onClose={() => setEditingExpense(null)}
        onSaved={(driveUpdated) => {
          setToast({
            message: driveUpdated ? 'D\u00E9pense modifi\u00E9e et Drive mis \u00E0 jour' : 'D\u00E9pense modifi\u00E9e',
            type: 'success',
          });
          loadExpenses();
          api.getAdminStats().then(setStats).catch(() => {});
        }}
        onDeleted={() => {
          setToast({ message: 'D\u00E9pense supprim\u00E9e', type: 'success' });
          loadExpenses();
          api.getAdminStats().then(setStats).catch(() => {});
        }}
      />
    </div>
  );
}
