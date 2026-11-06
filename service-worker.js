/* Service Worker — Boutique Pro Sénégal.
   La liste PRECACHE et VERSION sont régénérées par `npm run build:sw` (ne pas éditer entre les marqueurs). */
// <GENERE>
const VERSION = 'af64a74bb0';
const PRECACHE = [ "./", "assets/icons/icon-128-maskable.png", "assets/icons/icon-128.png", "assets/icons/icon-144-maskable.png", "assets/icons/icon-144.png", "assets/icons/icon-152-maskable.png", "assets/icons/icon-152.png", "assets/icons/icon-192-maskable.png", "assets/icons/icon-192.png", "assets/icons/icon-384-maskable.png", "assets/icons/icon-384.png", "assets/icons/icon-512-maskable.png", "assets/icons/icon-512.png", "assets/icons/icon-72-maskable.png", "assets/icons/icon-72.png", "assets/icons/icon-96-maskable.png", "assets/icons/icon-96.png", "assets/styles/app.css", "index.html", "manifest.json", "src/app.js", "src/config.js", "src/database/db.js", "src/modules/achats.js", "src/modules/caisse.js", "src/modules/clients.js", "src/modules/dashboard.js", "src/modules/parametres.js", "src/modules/produits.js", "src/modules/rapports.js", "src/modules/stock.js", "src/modules/ventes.js", "src/services/backup.js", "src/services/calculs.js", "src/services/cloud.js", "src/services/documents.js", "src/services/ops.js", "src/services/rapports.js", "src/services/session.js", "src/services/stock.js", "src/sync/sync.js", "src/ui.js", "src/utils/csv.js", "src/utils/format.js", "src/utils/id.js", "vendor/dexie.mjs", "vendor/supabase.js" ];
// </GENERE>
const CACHE = `bps-${VERSION}`;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('bps-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('message', e => { if (e.data === 'skipWaiting') self.skipWaiting(); });

self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;     // l'API distante n'est jamais mise en cache
  if (req.mode === 'navigate') {
    // Application shell : toujours disponible hors connexion.
    e.respondWith(caches.match('index.html').then(r => r || fetch(req)));
    return;
  }
  e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
    if (res.ok) { const copie = res.clone(); caches.open(CACHE).then(c => c.put(req, copie)); }
    return res;
  })));
});
