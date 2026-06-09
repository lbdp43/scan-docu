import React, { useEffect, useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../utils/api';
import Toast from '../components/Toast';

const CACHE_KEY = 'admin_users_v1';
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

export default function AdminUsers() {
  const cached = readCache();
  const [users, setUsers] = useState(cached?.users ?? []);
  const [loading, setLoading] = useState(!cached);
  const loadedRef = useRef(false);
  const [toast, setToast] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editingUser, setEditingUser] = useState(null);

  // Create form
  const [newEmail, setNewEmail] = useState('');
  const [newName, setNewName] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newCardId, setNewCardId] = useState('');
  const [newDriveFolder, setNewDriveFolder] = useState('');
  const [newRole, setNewRole] = useState('user');

  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    loadUsers();
  }, []);

  async function loadUsers() {
    try {
      const data = await api.getUsers();
      setUsers(data.users);
      writeCache({ users: data.users });
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate(e) {
    e.preventDefault();
    try {
      await api.createUser({
        email: newEmail,
        name: newName,
        password: newPassword,
        card_id: newCardId || undefined,
        drive_folder_id: newDriveFolder || undefined,
        role: newRole,
      });
      setToast({ message: 'Utilisateur créé', type: 'success' });
      setShowCreate(false);
      resetCreateForm();
      loadUsers();
    } catch (err) {
      setToast({ message: err.message, type: 'error' });
    }
  }

  function resetCreateForm() {
    setNewEmail('');
    setNewName('');
    setNewPassword('');
    setNewCardId('');
    setNewDriveFolder('');
    setNewRole('user');
  }

  async function toggleActive(userId, currentlyActive) {
    try {
      await api.updateUser(userId, { is_active: !currentlyActive });
      setToast({ message: currentlyActive ? 'Compte désactivé' : 'Compte activé', type: 'success' });
      loadUsers();
    } catch (err) {
      setToast({ message: err.message, type: 'error' });
    }
  }

  async function handleResetPassword(userId) {
    const newPwd = prompt('Nouveau mot de passe (min 8 caractères):');
    if (!newPwd || newPwd.length < 8) {
      if (newPwd !== null) setToast({ message: 'Mot de passe trop court (min 8)', type: 'error' });
      return;
    }
    try {
      await api.resetPassword(userId, newPwd);
      setToast({ message: 'Mot de passe réinitialisé', type: 'success' });
    } catch (err) {
      setToast({ message: err.message, type: 'error' });
    }
  }

  async function handleUpdateUser(e) {
    e.preventDefault();
    if (!editingUser) return;
    try {
      await api.updateUser(editingUser.id, {
        name: editingUser.name,
        email: editingUser.email,
        card_id: editingUser.card_id || null,
        drive_folder_id: editingUser.drive_folder_id || null,
        role: editingUser.role,
      });
      setToast({ message: 'Utilisateur modifié', type: 'success' });
      setEditingUser(null);
      loadUsers();
    } catch (err) {
      setToast({ message: err.message, type: 'error' });
    }
  }

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="flex items-center justify-between">
          <div className="h-7 bg-card rounded-xl w-48" />
          <div className="h-9 bg-card rounded-xl w-20" />
        </div>
        {[1,2,3].map(i => <div key={i} className="h-32 bg-card rounded-2xl" />)}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {toast && <Toast {...toast} onClose={() => setToast(null)} />}

      <div className="flex items-center justify-between">
        <div>
          <Link viewTransition to="/admin" className="text-green-light text-xs mb-1 inline-block">← Administration</Link>
          <h1 className="font-serif text-xl font-semibold">Gestion utilisateurs</h1>
        </div>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="px-4 py-2 rounded-xl bg-green-mid text-white text-sm font-medium transition-transform active:scale-[0.97]"
        >
          + Créer
        </button>
      </div>

      {/* Create form */}
      {showCreate && (
        <form onSubmit={handleCreate} className="p-5 rounded-3xl bg-card border border-card-border space-y-3">
          <h3 className="text-text font-semibold text-sm">Nouveau collaborateur</h3>
          <input
            type="text"
            placeholder="Prénom Nom"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            required
            className="w-full bg-bg border border-card-border rounded-xl px-4 py-3 text-text text-sm focus:outline-none focus:border-green-mid"
          />
          <input
            type="email"
            placeholder="email@lbdp.fr"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            required
            className="w-full bg-bg border border-card-border rounded-xl px-4 py-3 text-text text-sm focus:outline-none focus:border-green-mid"
          />
          <input
            type="password"
            placeholder="Mot de passe (min 8 caractères)"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
            minLength={8}
            className="w-full bg-bg border border-card-border rounded-xl px-4 py-3 text-text text-sm focus:outline-none focus:border-green-mid"
          />
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="N° carte (ex: CARTE-002)"
              value={newCardId}
              onChange={(e) => setNewCardId(e.target.value)}
              className="flex-1 bg-bg border border-card-border rounded-xl px-4 py-3 text-text text-sm focus:outline-none focus:border-green-mid"
            />
            <select
              value={newRole}
              onChange={(e) => setNewRole(e.target.value)}
              className="bg-bg border border-card-border rounded-xl px-3 py-3 text-text text-sm focus:outline-none focus:border-green-mid"
            >
              <option value="user">User</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <input
            type="text"
            placeholder="ID dossier Google Drive (optionnel)"
            value={newDriveFolder}
            onChange={(e) => setNewDriveFolder(e.target.value)}
            className="w-full bg-bg border border-card-border rounded-xl px-4 py-3 text-text text-sm focus:outline-none focus:border-green-mid"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => { setShowCreate(false); resetCreateForm(); }}
              className="flex-1 py-2.5 rounded-xl border border-card-border text-text-muted text-sm"
            >
              Annuler
            </button>
            <button
              type="submit"
              className="flex-1 py-2.5 rounded-xl bg-green-mid text-white text-sm font-medium"
            >
              Créer
            </button>
          </div>
        </form>
      )}

      {/* Edit modal */}
      {editingUser && (
        <form onSubmit={handleUpdateUser} className="p-5 rounded-3xl bg-card border border-green-mid/30 space-y-3">
          <h3 className="text-text font-semibold text-sm">Modifier — {editingUser.name}</h3>
          <input
            type="text"
            value={editingUser.name}
            onChange={(e) => setEditingUser({ ...editingUser, name: e.target.value })}
            className="w-full bg-bg border border-card-border rounded-xl px-4 py-3 text-text text-sm focus:outline-none focus:border-green-mid"
          />
          <input
            type="email"
            value={editingUser.email}
            onChange={(e) => setEditingUser({ ...editingUser, email: e.target.value })}
            className="w-full bg-bg border border-card-border rounded-xl px-4 py-3 text-text text-sm focus:outline-none focus:border-green-mid"
          />
          <div className="flex gap-2">
            <input
              type="text"
              value={editingUser.card_id || ''}
              onChange={(e) => setEditingUser({ ...editingUser, card_id: e.target.value })}
              placeholder="N° carte"
              className="flex-1 bg-bg border border-card-border rounded-xl px-4 py-3 text-text text-sm focus:outline-none focus:border-green-mid"
            />
            <select
              value={editingUser.role}
              onChange={(e) => setEditingUser({ ...editingUser, role: e.target.value })}
              className="bg-bg border border-card-border rounded-xl px-3 py-3 text-text text-sm focus:outline-none focus:border-green-mid"
            >
              <option value="user">User</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <input
            type="text"
            value={editingUser.drive_folder_id || ''}
            onChange={(e) => setEditingUser({ ...editingUser, drive_folder_id: e.target.value })}
            placeholder="ID dossier Drive"
            className="w-full bg-bg border border-card-border rounded-xl px-4 py-3 text-text text-sm focus:outline-none focus:border-green-mid"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setEditingUser(null)}
              className="flex-1 py-2.5 rounded-xl border border-card-border text-text-muted text-sm"
            >
              Annuler
            </button>
            <button
              type="submit"
              className="flex-1 py-2.5 rounded-xl bg-green-mid text-white text-sm font-medium"
            >
              Enregistrer
            </button>
          </div>
        </form>
      )}

      {/* Users list */}
      <div className="space-y-3">
        {users.map(u => (
          <div key={u.id} className={`p-4 rounded-2xl bg-card border border-card-border ${!u.is_active ? 'opacity-50' : ''}`}>
            <div className="flex items-center gap-3">
              <div className={`w-11 h-11 rounded-full flex items-center justify-center text-sm font-semibold ${
                u.role === 'admin' ? 'bg-gold/20 text-gold' : 'bg-green-mid/20 text-green-light'
              }`}>
                {u.name?.[0] || '?'}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-text font-medium text-sm truncate">{u.name}</p>
                  {u.role === 'admin' && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-gold/20 text-gold">Admin</span>
                  )}
                  {!u.is_active && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-400">Inactif</span>
                  )}
                </div>
                <p className="text-text-muted text-xs truncate">{u.email}</p>
                <p className="text-text-dim text-xs mt-0.5">
                  {u.card_id || 'Pas de carte'} · {u._count?.expenses || 0} dépenses
                </p>
              </div>
            </div>
            <div className="flex gap-2 mt-3 pt-3 border-t border-card-border">
              <button
                onClick={() => setEditingUser(u)}
                className="flex-1 py-1.5 rounded-lg bg-card border border-card-border text-text-muted text-xs"
              >
                Modifier
              </button>
              <button
                onClick={() => handleResetPassword(u.id)}
                className="flex-1 py-1.5 rounded-lg bg-card border border-card-border text-text-muted text-xs"
              >
                Reset MDP
              </button>
              <button
                onClick={() => toggleActive(u.id, u.is_active)}
                className={`flex-1 py-1.5 rounded-lg text-xs ${
                  u.is_active
                    ? 'bg-red-500/10 border border-red-500/20 text-red-400'
                    : 'bg-green-mid/10 border border-green-mid/20 text-green-light'
                }`}
              >
                {u.is_active ? 'Désactiver' : 'Activer'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
