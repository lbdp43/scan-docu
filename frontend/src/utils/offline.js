// IndexedDB wrapper for offline queue
const DB_NAME = 'lbdp-offline';
const DB_VERSION = 1;
const STORE_NAME = 'pending_uploads';

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function savePendingExpense(expense) {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  const store = tx.objectStore(STORE_NAME);

  const record = {
    id: crypto.randomUUID(),
    ...expense,
    timestamp: Date.now(),
    retries: 0,
    status: 'pending',
  };

  store.put(record);

  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(record);
    tx.onerror = () => reject(tx.error);
  });
}

export async function getPendingExpenses() {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, 'readonly');
  const store = tx.objectStore(STORE_NAME);
  const request = store.getAll();

  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

export async function removePendingExpense(id) {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  const store = tx.objectStore(STORE_NAME);
  store.delete(id);

  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function updatePendingExpense(id, updates) {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  const store = tx.objectStore(STORE_NAME);
  const getReq = store.get(id);

  return new Promise((resolve, reject) => {
    getReq.onsuccess = () => {
      const record = { ...getReq.result, ...updates };
      store.put(record);
      tx.oncomplete = () => resolve(record);
    };
    tx.onerror = () => reject(tx.error);
  });
}

// Sync pending expenses when back online
export async function syncPendingExpenses(apiSubmitFn) {
  const pending = await getPendingExpenses();
  const results = [];

  for (const expense of pending) {
    if (expense.retries >= 3) {
      await updatePendingExpense(expense.id, { status: 'failed' });
      continue;
    }

    try {
      await apiSubmitFn(expense);
      await removePendingExpense(expense.id);
      results.push({ id: expense.id, status: 'synced' });
    } catch {
      await updatePendingExpense(expense.id, {
        retries: expense.retries + 1,
        status: expense.retries + 1 >= 3 ? 'failed' : 'pending',
      });
      results.push({ id: expense.id, status: 'failed' });
    }
  }

  return results;
}

// Check online status
export function isOnline() {
  return navigator.onLine;
}

// Register background sync
export async function registerSync() {
  if ('serviceWorker' in navigator && 'SyncManager' in window) {
    const registration = await navigator.serviceWorker.ready;
    await registration.sync.register('sync-expenses');
  }
}
