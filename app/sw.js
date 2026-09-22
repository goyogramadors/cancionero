/* ============================================================
   Service worker — cachea el caparazón para uso offline.
   Vive en la RAÍZ de la app para controlar todo el ámbito (scope "/").
   Estrategia: stale-while-revalidate — responde del caché al instante
   (offline OK) y en segundo plano baja la versión nueva y actualiza el
   caché, así los cambios llegan en la siguiente carga sin quedar atascado
   en una versión vieja. Igual conviene subir CACHE en cada release.
   ============================================================ */
const CACHE = 'cancionero-v26';
const SHELL = [
  'index.html',
  'css/base.css',
  'core/music.js',
  'core/registry.js',
  'core/ui.js',
  'core/store.js',
  'core/github.js',
  'core/diagrams.js',
  'core/chords.js',
  'core/app.js',
  'data/songs.js',
  'tools/songbook/songbook.js',
  'tools/canta/canta.js',
  'tools/canta/canta-engine.js',
  'tools/canta/canta-pitch.js',
  'tools/canta/canta-motor.js',
  'tools/canta/canta-dsp.js',
  'tools/canta/canta-pitch-worklet.js',
  'tools/chords/chords.js',
  'tools/practice/practice.js',
  'tools/settings/settings.js',
  'manifest.webmanifest',
  'pwa/icon.svg'
];

self.addEventListener('install', (e) => {
  // cache:'reload' = pedir al servidor, NO a la caché HTTP del navegador:
  // GitHub Pages manda max-age=600, y sin esto un SW nuevo se llenaba con
  // los archivos VIEJOS que el navegador tenía guardados por 10 minutos.
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
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
  if (url.pathname.includes('/api/')) return;      // motor local: nunca cachear
  // Los paquetes de Canta (índice + canta.json + audios) cambian cuando preparas
  // o re-preparas una canción: red primero, para que no quede uno viejo pegado
  // (el caché queda solo como respaldo offline).
  if (url.pathname.includes('canta-media/')) {
    e.respondWith(
      fetch(e.request, { cache: 'no-cache' }).then((res) => {
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
      const network = fetch(e.request, { cache: 'no-cache' }).then((res) => {
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
