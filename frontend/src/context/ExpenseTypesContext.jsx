import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { api } from '../utils/api';
import { useAuth } from './AuthContext';

const ExpenseTypesContext = createContext({ types: [], typesMap: {}, loading: true, refresh: () => {} });

const CACHE_KEY = 'expense_types_v1';

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const { data, ts } = JSON.parse(raw);
    // Cache valid for 10 minutes
    return Date.now() - ts < 10 * 60 * 1000 ? data : null;
  } catch { return null; }
}

function writeCache(data) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ data, ts: Date.now() }));
  } catch {}
}

// Default fallback colors for dynamic types
const DEFAULT_COLORS = [
  'bg-green-mid/20 text-green-light',
  'bg-orange-500/20 text-orange-300',
  'bg-blue-500/20 text-blue-300',
  'bg-purple-500/20 text-purple-300',
  'bg-pink-500/20 text-pink-300',
  'bg-yellow-500/20 text-yellow-300',
  'bg-red-500/20 text-red-300',
  'bg-teal-500/20 text-teal-300',
];

export function buildTypesMap(types) {
  const map = {};
  types.forEach((t, i) => {
    map[t.value] = {
      icon: t.icon,
      label: t.label,
      color: DEFAULT_COLORS[i % DEFAULT_COLORS.length],
      hexColor: t.color || '#6B7280',
    };
  });
  // Fallback for unknown types
  if (!map['autre']) {
    map['autre'] = { icon: null, label: 'Autre', color: 'bg-gray-500/20 text-gray-300', hexColor: '#6B7280' };
  }
  return map;
}

export function ExpenseTypesProvider({ children }) {
  const { user } = useAuth();
  const cached = readCache();
  const [types, setTypes] = useState(cached || []);
  const [loading, setLoading] = useState(!cached);

  const refresh = useCallback(async () => {
    try {
      const result = await api.getExpenseTypes();
      setTypes(result.types);
      writeCache(result.types);
    } catch (err) {
      console.error('Failed to load expense types:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user) {
      refresh();
    }
  }, [user, refresh]);

  const typesMap = buildTypesMap(types);

  return (
    <ExpenseTypesContext.Provider value={{ types, typesMap, loading, refresh }}>
      {children}
    </ExpenseTypesContext.Provider>
  );
}

export function useExpenseTypes() {
  return useContext(ExpenseTypesContext);
}
