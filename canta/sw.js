/* ============================================================
   Service worker del sitio satelite "Canta" (para alumnos).
   Mismo patrón que app/sw.js: stale-while-revalidate para el
   caparazón, red-primero para canta-media/ (así una canción
   reprocesada no queda pegada en caché), con caché de respaldo
   para offline. Vive en su propia carpeta para no compartir scope
   ni caché con la PWA principal (app/).
   ============================================================ */
const CACHE = 'canta-alumnos-v1';
const SHELL = [
  'index.html',
  'manifest.webmanifest',
  '../app/css/base.css',
  '../app/core/music.js',
  '../app/core/registry.js',
  '../app/core/ui.js',
  '../app/core/store.js',
  '../app/tools/canta/canta-dsp.js',
  '../app/tools/canta/canta-pitch.js',
  '../app/tools/canta/canta-pitch-worklet.js',
  '../app/tools/canta/canta-motor.js',
  '../app/tools/canta/canta-engine.js',
  '../app/tools/canta/canta.js',
  '../app/pwa/icon.svg'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return; // deja pasar lo externo
  // Los paquetes de Canta (índice + canta.json + audios) cambian cuando se
  // reprocesa un ejercicio: red primero, para que no quede uno viejo pegado
  // (el caché queda solo como respaldo offline).
  if (url.pathname.includes('canta-media/')) {
    e.respondWith(
      fetch(e.request).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        }
        return res;
      }).catch(() => caches.match(e.request))
    );
    return;
  }
  e.respondWith(
    caches.match(e.request).then((hit) => {
      const network = fetch(e.request).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        }
        return res;
      }).catch(() => hit);
      return hit || network; // caché primero si existe; si no, red
    })
  );
});
