const SHELL_REVISION = '0.2.0-receipts-diagnosis-20260903';
const CACHE = `conductor-pocket-shell-${SHELL_REVISION}`;
const SHELL = [
  '/',
  '/index.html',
  '/app.css?v=0.2.0-receipts-diagnosis-20260903',
  '/app.js?v=0.2.0-receipts-diagnosis-20260903',
  '/bootstrap-recovery.js?v=0.2.0-receipts-diagnosis-20260903',
  '/delivery-receipts.js?v=0.2.0-receipts-diagnosis-20260903',
  '/draft-conflict.js?v=0.2.0-receipts-diagnosis-20260903',
  '/usage-state.js?v=0.2.0-receipts-diagnosis-20260903',
  '/connection-diagnosis.js?v=0.2.0-receipts-diagnosis-20260903',
  '/app-update.js?v=0.2.0-receipts-diagnosis-20260903',
  '/http.js?v=0.2.0-receipts-diagnosis-20260903',
  '/image-attachments.js?v=0.2.0-receipts-diagnosis-20260903',
  '/live-refresh.js?v=0.2.0-receipts-diagnosis-20260903',
  '/read-state.js?v=0.2.0-receipts-diagnosis-20260903',
  '/rich-text.js?v=0.2.0-receipts-diagnosis-20260903',
  '/transcript-focus.js?v=0.2.0-receipts-diagnosis-20260903',
  '/swipe-navigation.js?v=0.2.0-receipts-diagnosis-20260903',
  '/icon.svg',
  '/manifest.webmanifest',
];
const SHELL_PATHS = new Set([
  '/',
  '/index.html',
  '/app.css',
  '/app.js',
  '/bootstrap-recovery.js',
  '/delivery-receipts.js',
  '/draft-conflict.js',
  '/usage-state.js',
  '/connection-diagnosis.js',
  '/app-update.js',
  '/http.js',
  '/image-attachments.js',
  '/live-refresh.js',
  '/read-state.js',
  '/rich-text.js',
  '/transcript-focus.js',
  '/swipe-navigation.js',
  '/icon.svg',
  '/manifest.webmanifest',
]);
const SHELL_ASSET_PATHS = new Set([
  '/app.css',
  '/app.js',
  '/bootstrap-recovery.js',
  '/delivery-receipts.js',
  '/draft-conflict.js',
  '/usage-state.js',
  '/connection-diagnosis.js',
  '/app-update.js',
  '/http.js',
  '/image-attachments.js',
  '/live-refresh.js',
  '/read-state.js',
  '/rich-text.js',
  '/transcript-focus.js',
  '/swipe-navigation.js',
]);
const SCRIPT_CONTENT_TYPES = new Set([
  'application/ecmascript',
  'application/javascript',
  'text/ecmascript',
  'text/javascript',
]);

function shellAssetResponseIsValid(pathname, response) {
  if (!response?.ok) return false;
  const contentType = response?.headers
    ?.get('content-type')
    ?.split(';', 1)[0]
    ?.trim()
    ?.toLowerCase();
  if (pathname === '/app.css') return contentType === 'text/css';
  return SCRIPT_CONTENT_TYPES.has(contentType);
}

function documentResponseIsValid(response) {
  if (!response?.ok) return false;
  return response.headers
    .get('content-type')
    ?.split(';', 1)[0]
    ?.trim()
    ?.toLowerCase() === 'text/html';
}

async function fetchAndCache(request) {
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(CACHE);
    await cache.put(request, response.clone());
  }
  return response;
}

async function shellAssetResponse(request, requestUrl) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached && shellAssetResponseIsValid(requestUrl.pathname, cached)) {
    return cached;
  }
  if (cached) await cache.delete(request);

  const response = await fetch(request);
  if (!shellAssetResponseIsValid(requestUrl.pathname, response)) {
    throw new Error('shell_asset_content_type_mismatch');
  }
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

async function cachedDocumentResponse() {
  const cache = await caches.open(CACHE);
  for (const documentUrl of ['/index.html', '/']) {
    const response = await cache.match(documentUrl);
    if (documentResponseIsValid(response)) return response;
    if (response) await cache.delete(documentUrl);
  }
  return new Response(
    'Conductor Pocket needs to refresh. Close Pocket and reopen it while online.',
    {
      status: 503,
      headers: {
        'Cache-Control': 'no-store',
        'Content-Type': 'text/plain; charset=utf-8',
      },
    },
  );
}

async function installShell() {
  try {
    const cache = await caches.open(CACHE);
    await cache.addAll(SHELL);
    for (const shellUrl of SHELL) {
      const pathname = new URL(shellUrl, self.location.origin).pathname;
      const response = await cache.match(shellUrl);
      const valid = SHELL_ASSET_PATHS.has(pathname)
        ? shellAssetResponseIsValid(pathname, response)
        : pathname === '/' || pathname === '/index.html'
          ? documentResponseIsValid(response)
          : true;
      if (!valid) {
        throw new Error('shell_asset_content_type_mismatch');
      }
    }
  } catch (error) {
    await caches.delete(CACHE);
    throw error;
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    installShell().then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.allSettled(
        keys
          .filter(
            (key) =>
              key.startsWith('conductor-pocket-shell-') &&
              key !== CACHE,
          )
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
      const windows = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });
      for (const client of windows) {
        client.postMessage({
          type: 'shell-activated',
          revision: SHELL_REVISION,
        });
      }
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (
    event.data?.type !== 'retirement-window-count' ||
    !event.ports?.[0]
  ) {
    return;
  }
  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clients) => {
        event.ports[0].postMessage({
          type: 'retirement-window-count',
          requestId: event.data.requestId,
          count: clients.length,
        });
      }),
  );
});

self.addEventListener('fetch', (event) => {
  const requestUrl = new URL(event.request.url);
  if (
    event.request.method !== 'GET' ||
    requestUrl.origin !== self.location.origin ||
    !SHELL_PATHS.has(requestUrl.pathname)
  ) {
    return;
  }
  if (SHELL_ASSET_PATHS.has(requestUrl.pathname)) {
    event.respondWith(shellAssetResponse(event.request, requestUrl));
    return;
  }
  if (requestUrl.pathname === '/' || requestUrl.pathname === '/index.html') {
    event.respondWith(cachedDocumentResponse());
    return;
  }
  event.respondWith(
    fetchAndCache(event.request).catch(async () => {
      const cache = await caches.open(CACHE);
      return cache.match(event.request);
    }),
  );
});
