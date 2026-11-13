// Einkauf PWA: lokale Grunddateien vorhalten. Externe Firebase-/OCR-Skripte
// werden bewusst NICHT zwischengespeichert.
const CACHE = 'einkauf-bento-v25';
const ASSETS = [
  './', './index.html', './styles.css', './permanent-marker.ttf', './app.js', './qr.js',
  './firebase-config.js', './manifest.webmanifest',
  './icon.svg', './icon-192.png', './icon-512.png'
];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('einkauf-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith(new URL(self.registration.scope).pathname)) return;
  // Network-first keeps updates easy on GitHub Pages; cached assets work offline.
  event.respondWith(fetch(req,{cache:'no-cache'}).then(response => {
    if (response.ok) {
      const copy = response.clone();
      event.waitUntil(caches.open(CACHE).then(c => c.put(req, copy)));
    }
    return response;
  }).catch(async () => {
    const cached = await caches.match(req);
    if (cached) return cached;
    if (req.mode === 'navigate') return caches.match('./index.html');
    return Response.error();
  }));
});
