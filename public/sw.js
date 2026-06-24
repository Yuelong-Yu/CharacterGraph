/* GreekMyths Service Worker — 缓存图像和数据 */
const CACHE_NAME = "greek-myths-v1";
const PRECACHE_URLS = [
  "/",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)),
      ),
    ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // 仅 cache 我们的图像和静态资源（同源）
  const sameOrigin = url.origin === self.location.origin;
  const isPortrait = url.pathname.startsWith("/images/portraits/");
  const isThumb = url.pathname.startsWith("/images/thumbs/");
  const isStatic = url.pathname.startsWith("/_next/static/");

  if (!sameOrigin || !(isPortrait || isThumb || isStatic)) return;

  // 策略：cache-first（图像永久缓存，版本号通过 CACHE_NAME 升级）
  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(req);
      if (cached) return cached;
      try {
        const resp = await fetch(req);
        if (resp.ok) cache.put(req, resp.clone());
        return resp;
      } catch (err) {
        if (cached) return cached;
        throw err;
      }
    }),
  );
});
