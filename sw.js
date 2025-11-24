// ===============================================================
// sw.js - Service Worker for SILO DERPLES
// ===============================================================

const CACHE_NAME = 'silo-pwa-v5';

const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/dmloader.js',
  '/SILOMobile_wasm.js',
  '/SILOMobile.wasm',
  '/titlePageV2.png',
  '/manifest.webmanifest'
];

async function safePrecache(cache, url) {
  try {
    const resp = await fetch(url, { cache: 'no-cache' });
    if (resp && resp.ok) {
      await cache.put(url, resp);
    } else {
      console.warn('[SW] skip precache (bad response):', url, resp && resp.status);
    }
  } catch (e) {
    console.warn('[SW] skip precache (fetch error):', url, e);
  }
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    console.log('[SW] Installing service worker, caching assets...');
    const cache = await caches.open(CACHE_NAME);
    for (const url of PRECACHE_URLS) {
      await safePrecache(cache, url);
    }
    console.log('[SW] Precache complete');
    self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    console.log('[SW] Activating service worker...');
    const keys = await caches.keys();
    const oldCaches = keys.filter(k => k !== CACHE_NAME && k.startsWith('silo-'));
    if (oldCaches.length > 0) {
      console.log('[SW] Deleting old caches:', oldCaches);
      await Promise.all(oldCaches.map(k => caches.delete(k)));
    }
    await self.clients.claim();
    console.log('[SW] Service worker activated');
  })());
});

function isAsset(reqUrl) {
  return (
    reqUrl.endsWith('.js')   ||
    reqUrl.endsWith('.wasm') ||
    reqUrl.endsWith('.json') ||
    reqUrl.endsWith('.png')  ||
    reqUrl.endsWith('.jpg')  ||
    reqUrl.endsWith('.jpeg') ||
    reqUrl.endsWith('.webp') ||
    reqUrl.endsWith('.mp3')  ||
    reqUrl.endsWith('.ogg')
  );
}

// Check if request URL is cacheable (only http/https schemes)
function isCacheableRequest(request) {
  const url = new URL(request.url);
  const scheme = url.protocol;
  // Only cache http:// and https:// requests
  // Exclude: chrome-extension://, moz-extension://, data:, blob:, etc.
  return scheme === 'http:' || scheme === 'https:';
}

self.addEventListener('fetch', event => {
  const { request } = event;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  if (url.pathname === '/favicon.ico' || url.pathname.startsWith('/icons/')) {
    return;
  }

  if (request.mode === 'navigate') {
    // Skip caching for non-HTTP/HTTPS navigation requests
    if (!isCacheableRequest(request)) {
      return; // Let browser handle it normally
    }
    
    event.respondWith((async () => {
      try {
        const fresh = await fetch(request);
        if (fresh && fresh.ok && isCacheableRequest(request)) {
          const cache = await caches.open(CACHE_NAME);
          cache.put('/index.html', fresh.clone());
        }
        return fresh;
      } catch {
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match('/index.html');
        if (cached) return cached;
        return new Response('<h1>Offline</h1>', { headers: { 'Content-Type': 'text/html' }, status: 503 });
      }
    })());
    return;
  }

  // Don't cache archive_files.json - it changes when game is rebuilt
  // Also don't cache archive files (.arci, .arcd, etc.) as they may change
  if (url.pathname === '/archive_files.json' || 
      url.pathname.endsWith('/archive_files.json') ||
      url.pathname.includes('/archive/archive_files.json')) {
    event.respondWith(fetch(request, { cache: 'no-cache' }));
    return;
  }
  
  // Don't cache archive files - they change when game is rebuilt
  if (url.pathname.match(/\.(arci|arcd|dmanifest|projectc|public\.der)$/)) {
    event.respondWith(fetch(request, { cache: 'no-cache' }));
    return;
  }

  if (isAsset(url.pathname)) {
    // Skip caching for non-HTTP/HTTPS requests (extensions, data URIs, etc.)
    if (!isCacheableRequest(request)) {
      return; // Let browser handle it normally
    }
    
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(request);
      if (cached) {
        // Return cached version immediately, but update in background
        fetch(request).then(resp => {
          if (resp && resp.ok && isCacheableRequest(request)) {
            cache.put(request, resp.clone());
          }
        }).catch(() => {
          // Ignore background fetch errors
        });
        return cached;
      }

      try {
        const resp = await fetch(request);
        if (resp && resp.ok && isCacheableRequest(request)) {
          cache.put(request, resp.clone());
        }
        return resp;
      } catch {
        return new Response('Network error', { status: 502 });
      }
    })());
    return;
  }

  // Skip caching for non-HTTP/HTTPS requests
  if (!isCacheableRequest(request)) {
    return; // Let browser handle it normally
  }
  
  event.respondWith((async () => {
    try {
      const fresh = await fetch(request);
      return fresh;
    } catch {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(request);
      if (cached) return cached;
      throw new Error('Fetch failed and no cache available');
    }
  })());
});


