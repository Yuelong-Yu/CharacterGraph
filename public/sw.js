/* GreekMyths Service Worker — self-unregistering kill-switch
 *
 * 历史:旧版 sw.js precache 了 "/" 并把 HTML 缓存住,导致 dev 改前端后
 * 浏览器仍拿到旧 HTML(hydration mismatch)。本版本不再缓存任何东西,
 * 激活时清空所有 cache + 注销自己 + 让所有窗口热刷新,从此彻底退出。
 *
 * 旧 SW 经 navigator.serviceWorker 自动 update 检查时会拉到本文件,
 * 触发 install→activate,完成清理。用户只需要刷新页面即可。
 */

self.addEventListener("install", () => {
  // 跳过 waiting,立即接管
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    // 1) 删除所有缓存
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));

    // 2) 立刻接管所有 client
    await self.clients.claim();

    // 3) 注销自己
    await self.registration.unregister();

    // 4) 通知所有窗口刷新一次,让其挣脱旧 SW
    const clients = await self.clients.matchAll({ type: "window" });
    for (const client of clients) {
      client.navigate(client.url).catch(() => {});
    }
  })());
});

// fetch 不拦截 — 一切走网络
