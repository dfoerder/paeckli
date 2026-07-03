// Cache-Version bei Änderungen an den App-Dateien manuell hochzählen.
const CACHE_NAME = 'weihnachtspaeckli-v29';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './config.js',
  './manifest.json',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((c) =>
      Promise.allSettled(ASSETS.map((a) => c.add(a))))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  // Nur GET cachen. Supabase-API/Auth-Aufrufe (POST etc.) immer direkt durchreichen.
  if (req.method !== 'GET') return;

  e.respondWith(
    fetch(req)
      .then((response) => {
        // Nur App-Assets (same-origin + CDN) im Cache aktualisieren.
        const url = new URL(req.url);
        const cacheable = url.origin === self.location.origin ||
                          url.host === 'cdn.jsdelivr.net';
        if (cacheable && response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
        }
        return response;
      })
      .catch(() => caches.match(req))
  );
});
