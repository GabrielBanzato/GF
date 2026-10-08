// Service worker: deixa o app abrir sem internet (a API nunca é cacheada).
const CACHE = 'zeni-v2';
const SHELL = [
  '/', '/index.html', '/styles.css', '/manifest.webmanifest', '/icons/icon.svg', '/icons/icon-180.png', '/icons/icon-192.png', '/icons/icon-512.png',
  '/js/app.js', '/js/api.js', '/js/store.js', '/js/sync.js', '/js/voice.js', '/js/backup.js', '/js/i18n.js',
  '/shared/ledger.js', '/shared/spreadsheet.js', '/vendor/exceljs.min.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

// Rede primeiro (sempre a versão mais nova); sem rede, usa o cache.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('/index.html'))),
  );
});
