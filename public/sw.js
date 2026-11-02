/**
 * Service Worker：带指纹静态产物的离线缓存 + 页面永远拿新。
 *
 * 防自锁设计（旧版 cache-first 无版本标识，旧页面/旧 JS 回把自己锁死在
 * Cache Storage 里——新版 sw.js 没机会执行，用户永远看到旧版）：
 *
 * 1. HTML / sw.js / manifest / 接口一律 network-first：网络通时新版永远能
 *    到达页面；只有网络失败才回退缓存（离线兜底）。
 * 2. 只有带指纹的 /assets/* 允许 cache-first：产物文件名带内容指纹，
 *    内容变了名字就变，缓存安全且能给 PWA 离线能力。
 * 3. cache 名带版本段：升级时清掉同前缀的旧 cache——哪怕未来再出策略错误，
 *    下一个版本只要换 CACHE 名就能把旧缓存带走，留「解开」的路径。
 *
 * 配套：服务端对 index.html / sw.js / manifest 回 Cache-Control: no-store
 * （tests/static.test.mjs 已覆盖），SW 本体的更新检查每次都能打到源站。
 */
const CACHE = 'vibe-study-v2'
const SHELL = ['/', '/index.html', '/manifest.webmanifest']

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)))
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith('vibe-study-') && key !== CACHE)
            .map((key) => caches.delete(key)),
        ),
      ),
  )
  self.clients.claim()
})

/** 带指纹的产物：文件名随内容变，缓存命中是安全的；命中不了才走网络并回填。 */
function isFingerprintedAsset(url) {
  return url.origin === self.location.origin && url.pathname.startsWith('/assets/')
}

/** 接口与其他必须拿新的路径：一律 network-first。 */
function isApiOrFreshPath(url) {
  return (
    url.pathname.startsWith('/api/') ||
    url.pathname === '/sw.js' ||
    url.pathname === '/manifest.webmanifest' ||
    url.pathname === '/' ||
    url.pathname === '/index.html'
  )
}

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  // 跨域请求（模型上游等）不经 SW，直连网络。
  if (url.origin !== self.location.origin) return

  // 接口与「必须拿新」的路径：network-first，网络失败仅 HTML 类回退到缓存的 index.html。
  if (isApiOrFreshPath(url)) {
    if (url.pathname.startsWith('/api/')) return // 接口：不拦截、不缓存、不排队
    event.respondWith(
      fetch(request).catch(() =>
        caches.match(request).then((cached) => cached ?? caches.match('/index.html')),
      ),
    )
    return
  }

  // 带指纹静态产物：cache-first；未命中走网络并回填（离线可读的资产）。
  if (isFingerprintedAsset(url)) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ??
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone()
              caches.open(CACHE).then((cache) => cache.put(request, copy))
            }
            return response
          }),
      ),
    )
    return
  }

  // 其余静态资源（图标等）：network-first、失败回退缓存。
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone()
          caches.open(CACHE).then((cache) => cache.put(request, copy))
        }
        return response
      })
      .catch(() => caches.match(request)),
  )
})
