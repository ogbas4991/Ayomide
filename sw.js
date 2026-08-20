/* Ayomide Studio — Service Worker v3 (app shell + share-target intake) */
const VERSION = 'ayomide-studio-v3.2.1';
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/app.js',
  './js/utils.js',
  './js/db.js',
  './js/chat.js',
  './js/files.js',
  './js/editor.js',
  './js/video.js',
  './js/exporter.js',
  './js/sync.js',
  './js/vault.js',
  './js/branding.js',
  './js/tools.js',
  './js/palette.js',
  './js/i18n.js',
  './js/aiimage.js',
  './js/actions.js',
  './js/batch.js',
  './js/exif.js',
  './js/gif.js',
  './js/pdfmake.js',
  './js/qr.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-64.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    await cache.addAll(ASSETS);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

async function staleWhileRevalidate(request) {
  const cache = await caches.open(VERSION);
  const cached = await cache.match(request, { ignoreSearch: true });
  const network = fetch(request)
    .then((res) => {
      if (res && res.ok && new URL(request.url).origin === self.location.origin) {
        cache.put(request, res.clone());
      }
      return res;
    })
    .catch(() => null);
  return cached || (await network) || new Response('Offline', { status: 503, statusText: 'Offline' });
}

/* ---- share-target intake: stash shared files into IndexedDB for the app ---- */
function shareDbPut(files) {
  return new Promise((resolve) => {
    const req = indexedDB.open('ayomide-studio', 2);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains('share-in')) d.createObjectStore('share-in', { keyPath: 'id' });
    };
    req.onsuccess = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('share-in')) { resolve(); return; }
      const tx = db.transaction('share-in', 'readwrite');
      const store = tx.objectStore('share-in');
      files.forEach((f, i) => {
        store.put({
          id: 'sw-' + Date.now().toString(36) + '-' + i,
          name: f.name || 'shared-file',
          type: f.type || '',
          blob: f
        });
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    };
    req.onerror = () => resolve();
  });
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method === 'POST' && url.searchParams.has('share-target')) {
    event.respondWith((async () => {
      try {
        const form = await request.formData();
        const files = [...form.getAll('files'), ...form.getAll('media')].filter((f) => f && typeof f.size === 'number');
        if (files.length) await shareDbPut(files);
        const text = form.get('text') || form.get('title') || '';
        if (text && !files.length) {
          const b = new Blob([text], { type: 'text/plain' });
          b.name = 'shared-text.txt';
          await shareDbPut([b]);
        }
      } catch (e) { /* keep going */ }
      return Response.redirect('./', 303);
    })());
    return;
  }

  if (request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(request);
        const cache = await caches.open(VERSION);
        cache.put('./index.html', fresh.clone());
        return fresh;
      } catch (e) {
        const cache = await caches.open(VERSION);
        return (await cache.match(request)) || (await cache.match('./index.html')) ||
          new Response('Offline', { status: 503 });
      }
    })());
    return;
  }

  event.respondWith(staleWhileRevalidate(request));
});
