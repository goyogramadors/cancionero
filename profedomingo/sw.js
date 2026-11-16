/* ============================================================
   Service worker del sitio "Piano · Profe Domingo".
   Mismo patrón que app/sw.js: caché primero y se revalida en segundo
   plano. El shell incluye rutas absolutas hacia /cancionero/app/.
   Si cambia algún archivo del shell, sube el número de CACHE.
   ============================================================ */
const CACHE = 'profedomingo-v3';
const SHELL = [
  'index.html',
  'manifest.webmanifest',
  'theme.css',
  'logo.jpg',
  'icono-192.png',
  '/cancionero/app/css/base.css',
  '/cancionero/app/core/music.js',
  '/cancionero/app/core/registry.js',
  '/cancionero/app/core/ui.js',
  '/cancionero/app/core/store.js',
  '/cancionero/app/core/piano-sonido.js',
  '/cancionero/app/tools/piano/piano.js',
  '/cancionero/app/core/app.js'
];

self.addEventListener('install', (e) => {
  // cache:'reload' = pedir al servidor y no a la caché HTTP del navegador
  // (GitHub Pages manda max-age=600).
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('profedomingo-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return; // deja pasar lo externo (muestras del piano)
  e.respondWith(
    caches.open(CACHE).then((c) => c.match(e.request).then((hit) => {
      const network = fetch(e.request, { cache: 'no-cache' }).then((res) => {
        if (res && res.ok) c.put(e.request, res.clone()).catch(() => {});
        return res;
      }).catch(() => hit);
      return hit || network;
    }))
  );
});
