// Network-first pro vlastní soubory aplikace, offline fallback z cache.
// Požadavky na jiné domény (Firebase, Gemini, CDN) service worker nechává být.
const CACHE = 'tipovacka-v30';
const ASSETS = ['./', 'index.html', 'style.css', 'app.js', 'manifest.json', 'logo.jpg', 'icon-192.png',
  'rankings_badge.png', 'medal_gold.jpg', 'medal_silver.jpg', 'medal_bronze.jpg'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }))
  );
});
