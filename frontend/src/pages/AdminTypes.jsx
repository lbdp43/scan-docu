import React, { useEffect, useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../utils/api';
import { useExpenseTypes } from '../context/ExpenseTypesContext';
import Toast from '../components/Toast';
import TypeIcon, { IconPicker, ICON_LABELS } from '../components/TypeIcon';

const CACHE_KEY = 'admin_types_v1';
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

export default function AdminTypes() {
  const { refresh: refreshGlobalTypes } = useExpenseTypes();
  const cached = readCache();
  const [types, setTypes] = useState(cached?.types ?? []);
  const [loading, setLoading] = useState(!cached);
  const loadedRef = useRef(false);
  const [toast, setToast] = useState(null);

  // Create form
  const [showCreate, setShowCreate] = useState(false);
  const [newValue, setNewValue] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [newIcon, setNewIcon] = useState('');
  const [newColor, setNewColor] = useState('#6B7280');
  const [creating, setCreating] = useState(false);

  // Edit state
  const [editingId, setEditingId] = useState(null);
  const [editLabel, setEditLabel] = useState('');
  const [editIcon, setEditIcon] = useState('');
  const [editColor, setEditColor] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    loadTypes();
  }, []);

  async function loadTypes() {
    try {
      const result = await api.getAllExpenseTypes();
      setTypes(result.types);
      writeCache({ types: result.types });
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate(e) {
    e.preventDefault();
    if (!newValue || !newLabel || !newIcon) {
      setToast({ message: 'Tous les champs sont requis', type: 'error' });
      return;
    }
    setCreating(true);
    try {
      await api.createExpenseType({
        value: newValue.toLowerCase().replace(/[^a-z0-9_-]/g, '_'),
        label: newLabel,
        icon: newIcon,
        color: newColor,
      });
      setToast({ message: 'Type cr\u00E9\u00E9', type: 'success' });
      setShowCreate(false);
      setNewValue('');
      setNewLabel('');
      setNewIcon('');
      setNewColor('#6B7280');
      await loadTypes();
      refreshGlobalTypes();
    } catch (err) {
      setToast({ message: err.message || 'Erreur', type: 'error' });
    } finally {
      setCreating(false);
    }
  }

  function startEdit(type) {
    setEditingId(type.id);
    setEditLabel(type.label);
    setEditIcon(type.icon);
    setEditColor(type.color);
  }

  async function handleSaveEdit() {
    setSaving(true);
    try {
      await api.updateExpenseType(editingId, {
        label: editLabel,
        icon: editIcon,
        color: editColor,
      });
      setToast({ message: 'Type modifi\u00E9', type: 'success' });
      setEditingId(null);
      await loadTypes();
      refreshGlobalTypes();
    } catch (err) {
      setToast({ message: err.message || 'Erreur', type: 'error' });
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleActive(type) {
    try {
      await api.updateExpenseType(type.id, { is_active: !type.is_active });
      setToast({
        message: type.is_active ? 'Type d\u00E9sactiv\u00E9' : 'Type r\u00E9activ\u00E9',
        type: 'success',
      });
      await loadTypes();
      refreshGlobalTypes();
    } catch (err) {
      setToast({ message: err.message || 'Erreur', type: 'error' });
    }
  }

  async function handleDelete(type) {
    if (!confirm(`Supprimer le type "${type.label}" ?`)) return;
    try {
      const result = await api.deleteExpenseType(type.id);
      if (result.deactivated) {
        setToast({ message: result.message, type: 'warning' });
      } else {
        setToast({ message: 'Type supprim\u00E9', type: 'success' });
      }
      await loadTypes();
      refreshGlobalTypes();
    } catch (err) {
      setToast({ message: err.message || 'Erreur', type: 'error' });
    }
  }

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="flex items-center justify-between">
          <div className="h-7 bg-card rounded-xl w-44" />
          <div className="h-9 bg-card rounded-2xl w-32" />
        </div>
        {[1,2,3,4].map(i => <div key={i} className="h-16 bg-card rounded-2xl" />)}
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-up">
      {toast && <Toast {...toast} onClose={() => setToast(null)} />}

      <div className="flex items-center justify-between">
        <div>
          <Link to="/admin" className="text-green-light text-xs font-medium">&larr; Admin</Link>
          <h1 className="font-serif text-xl font-semibold mt-1">Types de d&eacute;penses</h1>
        </div>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="px-4 py-2 rounded-2xl bg-green-mid text-white font-medium text-sm transition-transform active:scale-[0.97]"
        >
          + Nouveau type
        </button>
      </div>

      {/* Create form */}
      {showCreate && (
        <form onSubmit={handleCreate} className="p-4 rounded-2xl bg-card border border-card-border space-y-3">
          <p className="text-text text-sm font-semibold">Cr&eacute;er un type</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] uppercase tracking-widest text-text-muted mb-1">
                Identifiant
              </label>
              <input
                type="text"
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
                placeholder="ex: hotel"
                maxLength={30}
                required
                className="w-full bg-bg border border-card-border rounded-xl px-3 py-2 text-text text-sm focus:outline-none focus:border-green-mid"
              />
              <p className="text-text-dim text-[9px] mt-0.5">Minuscules, sans espaces</p>
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-widest text-text-muted mb-1">
                Libell&eacute;
              </label>
              <input
                type="text"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="ex: H\u00F4tel"
                maxLength={50}
                required
                className="w-full bg-bg border border-card-border rounded-xl px-3 py-2 text-text text-sm focus:outline-none focus:border-green-mid"
              />
            </div>
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-text-muted mb-1.5">
              Ic{'\u00F4'}ne
            </label>
            <IconPicker value={newIcon} onChange={setNewIcon} color={newColor} />
            {newIcon && (
              <p className="text-text-muted text-[10px] mt-1.5">
                S{'\u00E9'}lectionn{'\u00E9'} : <span className="text-green-light font-medium">{ICON_LABELS[newIcon] || newIcon}</span>
              </p>
            )}
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-text-muted mb-1">
              Couleur
            </label>
            <div className="flex gap-2 items-center">
              <input
                type="color"
                value={newColor}
                onChange={(e) => setNewColor(e.target.value)}
                className="w-10 h-10 rounded-lg border border-card-border cursor-pointer bg-transparent"
              />
              <span className="text-text-muted text-xs font-mono">{newColor}</span>
              <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: newColor + '20', color: newColor }}>
                <TypeIcon icon={newIcon || 'other'} size={22} />
              </div>
            </div>
          </div>
          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={() => setShowCreate(false)}
              className="flex-1 py-2.5 rounded-xl bg-card border border-card-border text-text-muted font-medium text-sm"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={creating}
              className="flex-1 py-2.5 rounded-xl bg-green-mid text-white font-medium text-sm disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {creating ? (
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                'Cr\u00E9er'
              )}
            </button>
          </div>
        </form>
      )}

      {/* Types list */}
      <div className="space-y-2">
        {types.map((type) => (
          <div
            key={type.id}
            className={`p-4 rounded-2xl border transition-all ${
              type.is_active
                ? 'bg-card border-card-border'
                : 'bg-card/50 border-card-border/50 opacity-60'
            }`}
          >
            {editingId === type.id ? (
              /* Edit mode */
              <div className="space-y-3">
                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className="block text-[10px] uppercase tracking-widest text-text-muted mb-1">
                      Libell{'\u00E9'}
                    </label>
                    <input
                      type="text"
                      value={editLabel}
                      onChange={(e) => setEditLabel(e.target.value)}
                      maxLength={50}
                      className="w-full bg-bg border border-card-border rounded-xl px-3 py-2 text-text text-sm focus:outline-none focus:border-green-mid"
                    />
                  </div>
                  <div className="w-14">
                    <label className="block text-[10px] uppercase tracking-widest text-text-muted mb-1">
                      &nbsp;
                    </label>
                    <input
                      type="color"
                      value={editColor}
                      onChange={(e) => setEditColor(e.target.value)}
                      className="w-full h-[38px] rounded-lg border border-card-border cursor-pointer bg-transparent"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] uppercase tracking-widest text-text-muted mb-1.5">
                    Ic{'\u00F4'}ne
                  </label>
                  <IconPicker value={editIcon} onChange={setEditIcon} color={editColor} />
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setEditingId(null)}
                    className="flex-1 py-2 rounded-xl bg-card border border-card-border text-text-muted text-xs font-medium"
                  >
                    Annuler
                  </button>
                  <button
                    onClick={handleSaveEdit}
                    disabled={saving}
                    className="flex-1 py-2 rounded-xl bg-green-mid text-white text-xs font-medium disabled:opacity-50"
                  >
                    {saving ? 'Enregistrement...' : 'Enregistrer'}
                  </button>
                </div>
              </div>
            ) : (
              /* Display mode */
              <div className="flex items-center gap-3">
                <div
                  className="w-12 h-12 rounded-2xl flex items-center justify-center"
                  style={{ backgroundColor: type.color + '20', color: type.color }}
                >
                  <TypeIcon icon={type.icon} color={type.color} size={24} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-text text-sm font-semibold">{type.label}</p>
                    {!type.is_active && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-400">
                        D{'\u00E9'}sactiv{'\u00E9'}
                      </span>
                    )}
                  </div>
                  <p className="text-text-muted text-xs font-mono">{type.value}</p>
                </div>
                <div
                  className="w-5 h-5 rounded-full border-2 border-white/10"
                  style={{ backgroundColor: type.color }}
                />
                <div className="flex gap-1">
                  <button
                    onClick={() => startEdit(type)}
                    className="w-8 h-8 rounded-lg flex items-center justify-center text-text-muted hover:text-text hover:bg-card transition-colors"
                    title="Modifier"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                  </button>
                  <button
                    onClick={() => handleToggleActive(type)}
                    className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
                      type.is_active
                        ? 'text-amber-400/60 hover:text-amber-400 hover:bg-amber-500/10'
                        : 'text-green-light/60 hover:text-green-light hover:bg-green-mid/10'
                    }`}
                    title={type.is_active ? 'D\u00E9sactiver' : 'R\u00E9activer'}
                  >
                    {type.is_active ? (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></svg>
                    ) : (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M6 4l14 8-14 8V4z" /></svg>
                    )}
                  </button>
                  <button
                    onClick={() => handleDelete(type)}
                    className="w-8 h-8 rounded-lg flex items-center justify-center text-red-400/60 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                    title="Supprimer"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" /></svg>
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
        {types.length === 0 && (
          <p className="text-text-dim text-center py-8 text-sm">Aucun type configur&eacute;</p>
        )}
      </div>

      <div className="p-4 rounded-2xl bg-card border border-card-border">
        <p className="text-text-muted text-xs leading-relaxed">
          <strong className="text-text">Info :</strong> Supprimer un type utilis&eacute; par des d&eacute;penses le d&eacute;sactivera au lieu de le supprimer.
          Les types d&eacute;sactiv&eacute;s ne sont plus propos&eacute;s lors de la saisie mais restent visibles dans l'historique.
        </p>
      </div>
    </div>
  );
}
