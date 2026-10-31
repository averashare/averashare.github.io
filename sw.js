// Avera Mart service worker.
// Network-first for the app's own files (always revalidated, bypassing the browser's 10-minute HTTP cache),
// so every GitHub update shows up straight away when online; the saved copy is used only when offline. Firebase/Firestore traffic
// (other domains) is never touched, so business data is never served stale.
const CACHE = 'avera-mart-v45';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'secure.js', 'webshop.js', 'shop.html', 'shop.css', 'shop.js', 'firebase-config.js', 'logo.jpg', 'qr.png', 'icon-192.png', 'icon-512.png', 'manifest.json', 'manual.pdf'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    fetch(req, {cache:'no-cache'}).then(res => {
      if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req).then(r => r || (req.mode === 'navigate' ? caches.match('index.html') : undefined)))
  );
});
