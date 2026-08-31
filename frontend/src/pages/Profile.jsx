import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../utils/api';
import { getTheme, setTheme } from '../utils/theme';
import { getPushState, enablePush, disablePush, isIOS, isStandalone, pushPermission } from '../utils/push';
import Toast from '../components/Toast';

export default function Profile() {
  const { user, logout } = useAuth();
  const [toast, setToast] = useState(null);
  const [theme, setThemeState] = useState(getTheme());

  function handleTheme(t) {
    setThemeState(setTheme(t));
  }

  // — Notifications push (état + activer/désactiver sur CET appareil)
  const [push, setPush] = useState(null);
  const [pushBusy, setPushBusy] = useState(false);

  useEffect(() => {
    getPushState().then(setPush).catch(() => setPush({ supported: false, configured: false, subscribed: false }));
  }, []);

  async function handleEnablePush() {
    setPushBusy(true);
    try {
      await enablePush(); // déclenche la demande d'autorisation du téléphone
      setToast({ message: 'Notifications activées 🔔', type: 'success' });
    } catch (err) {
      setToast({ message: err.message || 'Activation refusée', type: 'error' });
    } finally {
      getPushState().then(setPush).catch(() => {});
      setPushBusy(false);
    }
  }

  async function handleDisablePush() {
    setPushBusy(true);
    try {
      await disablePush();
      setToast({ message: 'Notifications désactivées sur cet appareil', type: 'success' });
    } catch (err) {
      setToast({ message: err.message || 'Erreur', type: 'error' });
    } finally {
      getPushState().then(setPush).catch(() => {});
      setPushBusy(false);
    }
  }
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleChangePassword = async (e) => {
    e.preventDefault();

    if (newPassword.length < 8) {
      setToast({ message: 'Le mot de passe doit contenir au moins 8 caractères', type: 'error' });
      return;
    }
    if (newPassword !== confirmPassword) {
      setToast({ message: 'Les mots de passe ne correspondent pas', type: 'error' });
      return;
    }

    setLoading(true);
    try {
      await api.changePassword(currentPassword, newPassword);
      setToast({ message: 'Mot de passe modifié', type: 'success' });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setToast({ message: err.message || 'Erreur', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {toast && <Toast {...toast} onClose={() => setToast(null)} />}

      <h1 className="font-serif text-xl font-semibold">Mon profil</h1>

      {/* User info */}
      <div className="p-5 rounded-3xl bg-card border border-card-border space-y-4">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-full bg-green-mid/30 flex items-center justify-center text-2xl font-semibold text-green-light">
            {user?.name?.[0] || '?'}
          </div>
          <div>
            <p className="text-text font-semibold text-lg">{user?.name}</p>
            <p className="text-text-muted text-sm">{user?.email}</p>
          </div>
        </div>

        <div className="flex gap-4 pt-3 border-t border-card-border">
          <div className="flex-1">
            <p className="text-[10px] uppercase tracking-widest text-text-muted">Carte société</p>
            <p className="text-text font-mono text-sm mt-1">{user?.card_id || 'Non attribuée'}</p>
          </div>
          <div className="flex-1">
            <p className="text-[10px] uppercase tracking-widest text-text-muted">Rôle</p>
            <p className="text-text text-sm mt-1 capitalize">{user?.role || 'user'}</p>
          </div>
        </div>
      </div>

      {/* Notifications */}
      <div className="p-5 rounded-3xl bg-card border border-card-border">
        <h2 className="text-text font-semibold mb-1">{'🔔'} Notifications</h2>
        <p className="text-text-muted text-xs mb-3">
          Rappels des paiements {'à'} justifier, remboursements, alertes.
        </p>
        {push === null ? (
          <div className="h-11 rounded-2xl bg-bg animate-pulse" />
        ) : push.subscribed ? (
          <div className="flex items-center gap-2">
            <span className="flex-1 py-3 px-4 rounded-2xl bg-green-mid/15 border border-green-mid/40 text-green-light text-sm font-medium">
              {'✓'} Activ{'é'}es sur cet appareil
            </span>
            <button
              onClick={handleDisablePush}
              disabled={pushBusy}
              className="px-4 py-3 rounded-2xl bg-bg border border-card-border text-text-muted text-sm font-medium disabled:opacity-50"
            >
              D{'é'}sactiver
            </button>
          </div>
        ) : pushPermission() === 'denied' ? (
          <p className="text-amber-400 text-xs p-3 rounded-2xl bg-amber-500/10 border border-amber-500/25">
            Le t{'é'}l{'é'}phone a refus{'é'} les notifications pour cette app. Pour les r{'é'}activer :
            r{'é'}glages du t{'é'}l{'é'}phone {'→'} notifications {'→'} autoriser, puis reviens ici.
          </p>
        ) : !push.supported && isIOS() && !isStandalone() ? (
          <p className="text-text-muted text-xs p-3 rounded-2xl bg-bg border border-card-border">
            Sur iPhone, installe d'abord l'app : <span className="text-text">Partager {'→'} {'«'} Sur l'{'é'}cran d'accueil {'»'}</span>, puis reviens activer les notifications ici.
          </p>
        ) : !push.supported || !push.configured ? (
          <p className="text-text-dim text-xs p-3 rounded-2xl bg-bg border border-card-border">
            Notifications non disponibles sur ce navigateur.
          </p>
        ) : (
          <button
            onClick={handleEnablePush}
            disabled={pushBusy}
            className="w-full py-3 rounded-2xl bg-green-mid text-white font-medium text-sm transition-transform active:scale-[0.97] disabled:opacity-50"
          >
            {pushBusy ? 'Activation…' : 'Activer les notifications'}
          </button>
        )}
      </div>

      {/* Apparence */}
      <div className="p-5 rounded-3xl bg-card border border-card-border">
        <h2 className="text-text font-semibold mb-3">Apparence</h2>
        <div className="flex gap-2">
          <button
            onClick={() => handleTheme('dark')}
            className={`flex-1 py-3 rounded-2xl text-sm font-medium border transition-all ${
              theme === 'dark'
                ? 'bg-green-mid/20 border-green-mid text-green-light'
                : 'bg-bg border-card-border text-text-muted'
            }`}
          >
            {'🌙'} Sombre
          </button>
          <button
            onClick={() => handleTheme('light')}
            className={`flex-1 py-3 rounded-2xl text-sm font-medium border transition-all ${
              theme === 'light'
                ? 'bg-green-mid/20 border-green-mid text-green-light'
                : 'bg-bg border-card-border text-text-muted'
            }`}
          >
            {'☀️'} Clair
          </button>
        </div>
        <p className="text-text-dim text-[11px] mt-2">M{'é'}moris{'é'} sur cet appareil.</p>
      </div>

      {/* Change password */}
      <div className="p-5 rounded-3xl bg-card border border-card-border">
        <h2 className="text-text font-semibold mb-4">Changer le mot de passe</h2>
        <form onSubmit={handleChangePassword} className="space-y-3">
          <input
            type="password"
            placeholder="Mot de passe actuel"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            required
            className="w-full bg-bg border border-card-border rounded-2xl px-4 py-3 text-text text-sm focus:outline-none focus:border-green-mid"
          />
          <input
            type="password"
            placeholder="Nouveau mot de passe (min. 8 caractères)"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
            minLength={8}
            className="w-full bg-bg border border-card-border rounded-2xl px-4 py-3 text-text text-sm focus:outline-none focus:border-green-mid"
          />
          <input
            type="password"
            placeholder="Confirmer le nouveau mot de passe"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            className="w-full bg-bg border border-card-border rounded-2xl px-4 py-3 text-text text-sm focus:outline-none focus:border-green-mid"
          />
          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 rounded-2xl bg-green-mid text-white font-medium text-sm transition-transform active:scale-[0.97] disabled:opacity-50"
          >
            {loading ? 'Modification...' : 'Modifier le mot de passe'}
          </button>
        </form>
      </div>

      {/* Logout */}
      <button
        onClick={logout}
        className="w-full py-3 rounded-2xl border border-red-500/30 text-red-400 font-medium text-sm transition-transform active:scale-[0.97]"
      >
        Se déconnecter
      </button>
    </div>
  );
}
