// Service worker de Salas Secretas: deja la app abierta sin conexión (la carga inicial).
// Los datos de partida viven en Supabase: sin red no se guardan, así que la red manda.
const VERSION = 'salas-v1';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Solo mismo origen: Supabase y Google Fonts van directos a red.
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    // Navegación: red primero, y si no hay red, la última copia de la app.
    e.respondWith(
      fetch(req)
        .then(res => { caches.open(VERSION).then(c => c.put('./index.html', res.clone())); return res; })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Assets con hash de Vite y iconos: caché primero.
  e.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res.ok) caches.open(VERSION).then(c => c.put(req, res.clone()));
      return res;
    }))
  );
});
