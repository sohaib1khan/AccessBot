/* AccessBot Service Worker — NO CACHING
   This worker exists only to clear any previously cached assets from
   older service worker versions. All requests go straight to the network. */

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', e => {
    // Delete every cache that was created by any previous version
    e.waitUntil(
        caches.keys()
            .then(keys => Promise.all(keys.map(k => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

// No fetch handler — every request goes directly to the network
