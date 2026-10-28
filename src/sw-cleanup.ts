/**
 * dev 模式下注销残留的 service worker。
 *
 * 站点曾经以生产构建跑过，`public/sw.js` 会注册一个 cache-first 的 worker，
 * 把当时的 /src/*.tsx 模块与 index.html 缓存进 Cache Storage。
 * 后来切到 dev server：地址不变，浏览器每次取模块还是先到 SW，
 * 命中旧缓存就返回旧版 JS，新代码到不了页面 ——
 * 结果就是「feature 1 有了，之后的改动网页上看不到」这种版本错位。
 * 这个拦截不靠 HTTP 缓存头，DevTools 里 Disable cache 也绕不过。
 *
 * 生产下不做这件事：PROD 时会再注册回 SW，PWA 离线能力不受影响。
 */
export async function cleanupStaleServiceWorkers(): Promise<void> {
  if (!('serviceWorker' in navigator)) return

  try {
    const registrations = await navigator.serviceWorker.getRegistrations()
    await Promise.allSettled(registrations.map((registration) => registration.unregister()))
  } catch {
    // 注销失败最坏结果是继续看到旧版本一次；不能因此影响应用启动。
  }

  try {
    if (typeof caches !== 'undefined') {
      const keys = await caches.keys()
      await Promise.allSettled(keys.map((key) => caches.delete(key)))
    }
  } catch {
    // 清缓存失败同上，不阻塞启动。
  }
}
