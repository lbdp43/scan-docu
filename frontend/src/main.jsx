import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Register service worker for PWA + listen for sync messages
if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('/sw.js');

      // Check for waiting SW on first load
      if (reg.waiting) {
        window.dispatchEvent(new CustomEvent('sw-update-available', { detail: reg }));
      }

      // Detect when a new SW finishes installing and enters waiting state
      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing;
        if (!newWorker) return;
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            window.dispatchEvent(new CustomEvent('sw-update-available', { detail: reg }));
          }
        });
      });

      // When the new SW takes over, reload to get fresh assets
      let refreshing = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (refreshing) return;
        refreshing = true;
        window.location.reload();
      });
    } catch {}
  });

  // Listen for SYNC_PENDING messages from the service worker (Background Sync API)
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type === 'SYNC_PENDING') {
      window.dispatchEvent(new CustomEvent('sw-sync-pending'));
    }
  });
}
