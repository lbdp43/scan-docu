const API_BASE = import.meta.env.VITE_API_URL || '/api';

async function request(path, options = {}) {
  const token = localStorage.getItem('token');
  const headers = { ...options.headers };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  // Don't set Content-Type for FormData (browser sets it with boundary)
  if (!(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  // Handle token expiry
  if (res.status === 401) {
    const refreshToken = localStorage.getItem('refreshToken');
    if (refreshToken && !path.includes('/auth/')) {
      try {
        const refreshRes = await fetch(`${API_BASE}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken }),
        });
        if (refreshRes.ok) {
          const { token: newToken } = await refreshRes.json();
          localStorage.setItem('token', newToken);
          headers['Authorization'] = `Bearer ${newToken}`;
          const retryRes = await fetch(`${API_BASE}${path}`, { ...options, headers });
          if (!retryRes.ok) {
            const err = await retryRes.json().catch(() => ({}));
            throw new Error(err.error || 'Erreur serveur');
          }
          return retryRes.json();
        }
      } catch {
        // Refresh failed, logout
      }
    }
    localStorage.removeItem('token');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('user');
    window.location.href = '/login';
    throw new Error('Session expirée');
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Erreur ${res.status}`);
  }

  // Handle CSV downloads
  if (res.headers.get('content-type')?.includes('text/csv')) {
    return res.blob();
  }

  return res.json();
}

export const api = {
  // Auth
  login: (email, password) =>
    request('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  logout: () =>
    request('/auth/logout', { method: 'POST' }),
  me: () =>
    request('/auth/me'),
  changePassword: (currentPassword, newPassword) =>
    request('/auth/password', { method: 'PUT', body: JSON.stringify({ currentPassword, newPassword }) }),

  // Expenses
  getExpenses: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/expenses?${qs}`);
  },
  getRecentExpenses: () =>
    request('/expenses/recent'),
  getStats: () =>
    request('/expenses/stats'),
  createExpense: (data) =>
    request('/expenses', { method: 'POST', body: JSON.stringify(data) }),
  exportCSV: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/expenses/export/csv?${qs}`);
  },

  // Scan
  scanImage: (formData) =>
    request('/scan', { method: 'POST', body: formData }),
  submitScan: (formData) =>
    request('/scan/submit', { method: 'POST', body: formData }),

  // Admin
  getUsers: () =>
    request('/admin/users'),
  createUser: (data) =>
    request('/admin/users', { method: 'POST', body: JSON.stringify(data) }),
  updateUser: (id, data) =>
    request(`/admin/users/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  resetPassword: (id, newPassword) =>
    request(`/admin/users/${id}/reset-password`, { method: 'PUT', body: JSON.stringify({ newPassword }) }),
  getAdminStats: () =>
    request('/admin/stats'),
  getAdminExpenses: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/admin/expenses?${qs}`);
  },
  getDriveConfig: () =>
    request('/admin/drive-config'),
  updateDriveConfig: (data) =>
    request('/admin/drive-config', { method: 'PUT', body: JSON.stringify(data) }),
};
