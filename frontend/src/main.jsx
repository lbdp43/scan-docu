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
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });

  // Listen for SYNC_PENDING messages from the service worker (Background Sync API)
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type === 'SYNC_PENDING') {
      // Dispatch a custom event that Layout.jsx listens for
      window.dispatchEvent(new CustomEvent('sw-sync-pending'));
    }
  });
}
