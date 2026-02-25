/* AccessBot Service Worker — network-first for app shell/js/css; cache-first for others */
const CACHE = 'accessbot-v10';
const STATIC = [
    '/',
    '/index.html',
    '/settings.html',
    '/css/style.css',
    '/css/settings.css',
    '/css/accessibility.css',
    '/js/app.js',
    '/js/settings.js',
    '/js/voice.js',
    '/js/accessibility.js',
    '/manifest.json',
    '/icons/icon.svg',
    '/icons/icon-192.png',
    '/icons/icon-512.png',
];

self.addEventListener('install', e => {
    e.waitUntil(
        caches.open(CACHE)
            .then(c => c.addAll(STATIC.filter(u => !u.includes('icon'))))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', e => {
    e.waitUntil(
        caches.keys()
            .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', e => {
    // Only handle GET; skip API requests
    if (e.request.method !== 'GET') return;
    if (e.request.url.includes('/api/')) return;

    const reqUrl = new URL(e.request.url);
    const path = reqUrl.pathname;
    const criticalAsset =
        e.request.mode === 'navigate' ||
        path.endsWith('.html') ||
        path.endsWith('.js') ||
        path.endsWith('.css');

    if (criticalAsset) {
        e.respondWith(
            fetch(e.request)
                .then(res => {
                    if (res && res.status === 200 && e.request.url.startsWith(self.location.origin)) {
                        const clone = res.clone();
                        caches.open(CACHE).then(c => c.put(e.request, clone));
                    }
                    return res;
                })
                .catch(() => caches.match(e.request))
        );
        return;
    }

    e.respondWith(
        caches.match(e.request).then(cached => {
            const network = fetch(e.request).then(res => {
                if (res && res.status === 200 && e.request.url.startsWith(self.location.origin)) {
                    const clone = res.clone();
                    caches.open(CACHE).then(c => c.put(e.request, clone));
                }
                return res;
            }).catch(() => null);
            return cached || network;
        })
    );
});
