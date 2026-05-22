const CACHE_NAME = 'ulti-pro-v9'; // Bumped version!

const urlsToCache = [
  './',
  './index.html',
  './app.js',
  './manifest.json',
  './logo.svg' // Added logo to offline cache
];

// 1. Install and save the files
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache))
  );
  self.skipWaiting(); 
});

// 2. Clean up old versions when a new one takes over
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cache => {
          if (cache !== CACHE_NAME) {
            return caches.delete(cache); 
          }
        })
      );
    })
  );
  self.clients.claim();
});

// 3. Serve from cache, fallback to network
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request).then(response => {
      return response || fetch(event.request);
    })
  );
});
