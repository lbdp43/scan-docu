import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../utils/api';
import Toast from '../components/Toast';

export default function Profile() {
  const { user, logout } = useAuth();
  const [toast, setToast] = useState(null);
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
    <div className="space-y-6 animate-fade-up">
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
