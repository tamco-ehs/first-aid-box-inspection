'use client';

import { useEffect } from 'react';

// Registers the PWA service worker (app-shell offline support). The actual
// "don't lose my inspection" guarantee comes from the localStorage draft util,
// which works regardless of the service worker.
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;
    if (process.env.NODE_ENV !== 'production') return; // avoid caching during dev

    const onLoad = () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        /* registration is best-effort */
      });
    };
    window.addEventListener('load', onLoad);
    return () => window.removeEventListener('load', onLoad);
  }, []);

  return null;
}
