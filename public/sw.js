/**
 * Service Worker para A.T.O.M. Tactical OS PWA
 * Suporta cache estático e instalação como aplicativo autônomo.
 */

const CACHE_NAME = 'atom-tactical-v7';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/css/style.css',
  '/css/themes.css',
  '/css/atom-char.css',
  '/css/atom-ui.css',
  '/js/app.js',
  '/js/api.js',
  '/js/audio.js',
  '/js/live.js',
  '/js/atom-char.js',
  '/js/atom-bodies.js',
  '/js/themes.js',
  '/js/conversas.js',
  '/icons/atom-face.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn('Cache estático PWA parcial:', err);
      });
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Ignorar requisições de API (backend dinâmico e streaming SSE)
  if (event.request.url.includes('/api/')) {
    return;
  }

  if (event.request.method !== 'GET') return;

  // Rede primeiro (sempre a versão mais nova do cockpit); cache só quando estiver offline
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok && new URL(event.request.url).origin === self.location.origin) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
