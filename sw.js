// TEAM JMFIT · service worker: abre la app al instante desde el móvil y la actualiza en segundo plano.
const CACHE = 'jmfit-v47';
const SHELL = ['./', 'index.html', 'styles.css', 'config.js', 'exercises.js', 'data.js', 'app.js',
  'fix.js', 'invite.js', 'features.js', 'nutri.js', 'backup.js', 'forms.js', 'carga.js', 'meso.js', 'analitica.js', 'objetivos.js', 'splash.js', 'manifest.json', 'icon-192.png', 'logo.webp'];
// Archivos de fuera que no cambian nunca (versión fija): se guardan una vez
const IMMUTABLE = /^https:\/\/(cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@[\d.]+\/|fonts\.gstatic\.com\/)/;
const FONTS_CSS = /^https:\/\/fonts\.googleapis\.com\//;

self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting())); });   // 'reload': sin la caché del navegador, siempre la versión recién publicada
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = req.url, u = new URL(url);
  // Supabase, hojas de Google, vídeos…: siempre a la red
  if (u.origin !== location.origin && !IMMUTABLE.test(url) && !FONTS_CSS.test(url)) return;
  if (IMMUTABLE.test(url)) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(r => { if (r.ok) { const cp = r.clone(); caches.open(CACHE).then(c => c.put(req, cp)); } return r; })));
    return;
  }
  // App y estilos: lo guardado al instante y, a la vez, se descarga la versión nueva para la próxima vez
  e.respondWith(caches.open(CACHE).then(async c => {
    const hit = await c.match(req, { ignoreSearch: req.mode === 'navigate' });
    // 'no-cache': pregunta al servidor si hay versión nueva (las peticiones de página no admiten opciones: se pide la URL)
    const net = fetch(req.mode === 'navigate' ? new Request(req.url, { cache: 'no-cache', credentials: 'same-origin' }) : new Request(req, { cache: 'no-cache' })).then(r => { if (r.ok) c.put(req, r.clone()); return r; });
    if (hit) { e.waitUntil(net.catch(() => {})); return hit; }
    return net.catch(() => c.match('./'));
  }));
});
