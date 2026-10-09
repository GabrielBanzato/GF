// Service worker: deixa o app abrir sem internet (a API nunca é cacheada).
// O servidor troca __BUILD__ pela versão atual; cada publicação tem seu próprio cache.
const BUILD = '__BUILD__';
const CACHE = `midas-${BUILD}`;
const V = `/_/${BUILD}`;
const SHELL = [
  '/', '/manifest.webmanifest', '/icons/icon.svg', '/icons/icon-180.png', '/icons/icon-192.png', '/icons/icon-512.png',
  '/fonts/instrument-serif.woff2', '/fonts/instrument-serif-italic.woff2', '/vendor/exceljs.min.js',
  `${V}/styles.css`,
  ...['app', 'api', 'store', 'sync', 'voice', 'backup', 'i18n', 'native'].map((f) => `${V}/js/${f}.js`),
  ...['ledger', 'spreadsheet', 'tools', 'commands'].map((f) => `${V}/shared/${f}.js`),
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(SHELL.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;

  // Página: sempre a mais nova da rede (ignorando caches HTTP); offline, a guardada.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req, { cache: 'no-store' })
        .then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put('/', copy)); return res; })
        .catch(() => caches.match('/')),
    );
    return;
  }

  // Arquivos versionados nunca mudam: cache primeiro.
  if (url.pathname.startsWith('/_/')) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    })));
    return;
  }

  // O resto: rede primeiro, cache se estiver offline.
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true })),
  );
});
