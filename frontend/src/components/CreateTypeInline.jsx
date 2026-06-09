import React, { useState } from 'react';
import { api } from '../utils/api';
import { useExpenseTypes } from '../context/ExpenseTypesContext';
import TypeIcon, { IconPicker, ICON_LABELS } from './TypeIcon';

export default function CreateTypeInline({ onCreated, onCancel }) {
  const { refresh } = useExpenseTypes();
  const [label, setLabel] = useState('');
  const [icon, setIcon] = useState('');
  const [color, setColor] = useState('#6B7280');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState(null);

  async function handleCreate(e) {
    e.preventDefault();
    if (!label.trim() || !icon) {
      setError('Nom et ic\u00F4ne requis');
      return;
    }

    setCreating(true);
    setError(null);

    // Generate value from label
    const value = label
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 30);

    if (value.length < 2) {
      setError('Nom trop court (2 caract\u00E8res minimum)');
      setCreating(false);
      return;
    }

    try {
      const result = await api.createExpenseType({ value, label: label.trim(), icon, color });
      await refresh();
      onCreated?.(result.type.value);
    } catch (err) {
      setError(err.message || 'Erreur lors de la cr\u00E9ation');
      setCreating(false);
    }
  }

  return (
    <div className="p-4 rounded-2xl bg-card border border-green-mid/30 space-y-3 animate-fade-up">
      <div className="flex items-center justify-between">
        <p className="text-text text-sm font-semibold">Nouveau type de d{'\u00E9'}pense</p>
        <button
          type="button"
          onClick={onCancel}
          className="w-7 h-7 flex items-center justify-center rounded-full bg-bg text-text-muted text-sm leading-none"
        >
          {'\u00D7'}
        </button>
      </div>

      {error && (
        <p className="text-red-400 text-xs bg-red-500/10 rounded-lg px-3 py-2">{error}</p>
      )}

      <form onSubmit={handleCreate} className="space-y-3">
        <div>
          <label className="block text-[10px] uppercase tracking-widest text-text-muted mb-1">
            Nom
          </label>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="ex: Informatique"
            maxLength={50}
            autoFocus
            className="w-full bg-bg border border-card-border rounded-xl px-3 py-2.5 text-text text-sm focus:outline-none focus:border-green-mid"
          />
        </div>

        <div>
          <label className="block text-[10px] uppercase tracking-widest text-text-muted mb-1.5">
            Ic{'\u00F4'}ne
          </label>
          <IconPicker value={icon} onChange={setIcon} color={color} />
        </div>

        <div>
          <label className="block text-[10px] uppercase tracking-widest text-text-muted mb-1">
            Couleur
          </label>
          <div className="flex gap-2 items-center">
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="w-10 h-10 rounded-lg border border-card-border cursor-pointer bg-transparent"
            />
            <span className="text-text-muted text-xs font-mono">{color}</span>
            {icon && (
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center"
                style={{ backgroundColor: color + '20', color }}
              >
                <TypeIcon icon={icon} size={22} />
              </div>
            )}
          </div>
        </div>

        <div className="flex gap-3 pt-1">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 py-2.5 rounded-xl bg-bg border border-card-border text-text-muted font-medium text-sm"
          >
            Annuler
          </button>
          <button
            type="submit"
            disabled={creating || !label.trim() || !icon}
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
    </div>
  );
}
