import { api } from './api';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

export function pushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

// État courant : supporté ? configuré côté serveur ? déjà abonné ?
export async function getPushState() {
  if (!pushSupported()) return { supported: false, configured: false, subscribed: false };
  try {
    const { configured, key } = await api.getPushPublicKey();
    if (!configured || !key) return { supported: true, configured: false, subscribed: false };
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    return { supported: true, configured: true, subscribed: !!sub, key };
  } catch {
    return { supported: true, configured: false, subscribed: false };
  }
}

export async function enablePush() {
  if (!pushSupported()) throw new Error('Notifications non supportées sur cet appareil');
  const { configured, key } = await api.getPushPublicKey();
  if (!configured || !key) throw new Error('Notifications non configurées côté serveur');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Autorisation refusée');
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(key),
    });
  }
  await api.subscribePush(sub);
  return true;
}

export async function disablePush() {
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (sub) {
    try { await api.unsubscribePush(sub.endpoint); } catch {}
    await sub.unsubscribe();
  }
}

// iPhone/iPad — sur iOS, les notifications web n'existent QUE si l'app est
// installée sur l'écran d'accueil (PWA). Dans Safari simple, PushManager est absent.
export function isIOS() {
  return /iP(hone|ad|od)/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function isStandalone() {
  return window.matchMedia?.('(display-mode: standalone)')?.matches
    || window.navigator.standalone === true;
}

export function pushPermission() {
  return typeof Notification !== 'undefined' ? Notification.permission : 'unsupported';
}
