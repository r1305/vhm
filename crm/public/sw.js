const CACHE = 'vhm-crm-v__ASSET_VERSION__';
const CDN_CACHE = 'vhm-cdn-v1';
const CDN_HOSTS = ['cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', e => e.waitUntil(self.skipWaiting()));

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE && k !== CDN_CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

function cacheClone(cacheName, req, res) {
  const copy = res.clone();
  caches.open(cacheName).then(c => c.put(req, copy));
}

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  if (e.request.mode === 'navigate' || url.pathname.includes('/api/')) return;

  // CDN → cache-first
  if (CDN_HOSTS.includes(url.hostname)) {
    e.respondWith(
      caches.match(e.request).then(cached => {
        if (cached) return cached;
        return fetch(e.request).then(res => {
          if (res.ok) cacheClone(CDN_CACHE, e.request, res);
          return res;
        });
      })
    );
    return;
  }

  // Assets propios → network-first
  if (/\.(css|js|png|jpg|svg|ico|woff2?)(\?.*)?$/.test(url.pathname)) {
    e.respondWith(
      fetch(e.request).then(res => {
        if (res.ok) cacheClone(CACHE, e.request, res);
        return res;
      }).catch(() => caches.match(e.request))
    );
  }
});
