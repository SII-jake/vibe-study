import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { extname, join, normalize, sep } from 'node:path'
import { createGzip } from 'node:zlib'
import { LOGIN_PAGE_PATH, loginPageHtml, staticNeedsAuth } from './auth.mjs'

/** 按扩展名给出 MIME；mime.types 缺 webmanifest，这里显式登记。 */
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  // APK 走静态目录分发：壳内检查更新时按 /app/<apkName> 直接下载
  '.apk': 'application/vnd.android.package-archive',
}

const NO_STORE = 'no-store'
const LONG_CACHE = 'public, max-age=31536000, immutable'

/** 只压文本类资源；图片与字体本身已压缩，再压只会变大。 */
const COMPRESSIBLE = new Set([
  '.html',
  '.js',
  '.mjs',
  '.css',
  '.json',
  '.webmanifest',
  '.svg',
  '.txt',
  '.map',
])

function acceptsGzip(request) {
  const header = request.headers['accept-encoding']
  return typeof header === 'string' && /\bgzip\b/.test(header)
}

function cacheControlFor(pathname) {
  if (pathname.startsWith('/assets/')) return LONG_CACHE
  return NO_STORE
}

/** 解析请求路径，拒绝目录穿越；越界或非法编码返回 null。 */
function resolveInside(root, pathname) {
  let decoded
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return null
  }
  if (decoded.includes('\0')) return null

  const normalized = normalize(decoded).replace(/^([/\\])+/, '')
  if (normalized === '..' || normalized.startsWith(`..${sep}`)) return null

  const absolute = join(root, normalized)
  const rootWithSep = root.endsWith(sep) ? root : `${root}${sep}`
  if (absolute !== root && !absolute.startsWith(rootWithSep)) return null
  return absolute
}

async function readFileIfExists(path) {
  try {
    const info = await stat(path)
    return info.isFile() ? path : null
  } catch {
    return null
  }
}

/**
 * 静态资源处理器。
 * 部署位置由进程自身的启动目录决定，调用方无需在反向代理里写文件路径。
 * opts.auth 形如 config.auth；未配置口令时与引入拦截前行为一致。
 */
export function createStaticHandler(root, opts = {}) {
  const indexFile = join(root, 'index.html')
  const auth = opts.auth ?? null
  const loginBody = auth?.enabled ? loginPageHtml() : null

  return async function serveStatic(request, response) {
    const pathname = new URL(request.url, 'http://localhost').pathname

    // 登录页本身必须无条件可达，否则永远登不上
    if (auth?.enabled && pathname === LOGIN_PAGE_PATH) {
      const body = Buffer.from(loginBody, 'utf8')
      response.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Length': body.length,
        'Cache-Control': 'no-store',
      })
      request.method === 'HEAD' ? response.end() : response.end(body)
      return
    }

    // 未登录的页面/资源访问一律引导到登录页；登录后会话 Cookie 由浏览器自带
    // 用 303 而非 302：POST 被门挡下时重定向后统一以 GET 打开登录页，
    // 避免某些客户端对 302 保留方法的歧义
    if (staticNeedsAuth(request, auth, pathname)) {
      response.writeHead(303, {
        Location: LOGIN_PAGE_PATH,
        'Cache-Control': 'no-store',
        'Content-Length': 0,
      })
      response.end()
      return
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' })
      response.end('方法不被允许')
      return
    }

    const target = resolveInside(root, pathname)
    if (target === null) {
      response.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' })
      response.end('禁止访问')
      return
    }

    const direct = await readFileIfExists(target === root ? indexFile : target)
    // 带扩展名的请求一律视为静态产物：缺失就是缺失，绝不能回退成 index.html。
    // 2026-11-22 排查：构建产物落在 /static/ 而非 /assets/，旧的 startsWith('/assets/')
    // 判定漏掉了它——旧 hash 的 css/js 因此拿到 200 + text/html 的 index.html，
    // 配合下面的 nosniff 被浏览器拒绝当作样式/脚本应用，页面永久无样式，
    // 表现就是用户说的"这个 css 一直卡死"。无扩展名的前端路由仍回 index.html。
    const looksLikeAsset = extname(pathname) !== ''
    const file = direct ?? (looksLikeAsset ? null : await readFileIfExists(indexFile))

    if (!file) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      response.end('未找到')
      return
    }

    const extension = extname(file).toLowerCase()
    const type = MIME_TYPES[extension] ?? 'application/octet-stream'
    const info = await stat(file)
    const useGzip = acceptsGzip(request) && COMPRESSIBLE.has(extension)

    const headers = {
      'Content-Type': type,
      'Cache-Control': cacheControlFor(pathname),
      'X-Content-Type-Options': 'nosniff',
    }
    // 压缩后长度未知，改用分块传输；不压缩时给出准确长度。
    if (useGzip) {
      headers['Content-Encoding'] = 'gzip'
      headers.Vary = 'Accept-Encoding'
    } else {
      headers['Content-Length'] = info.size
    }
    response.writeHead(200, headers)

    if (request.method === 'HEAD') {
      response.end()
      return
    }

    await new Promise((resolve) => {
      const stream = createReadStream(file)
      const source = useGzip ? stream.pipe(createGzip()) : stream
      source.on('error', () => {
        response.destroy()
        resolve()
      })
      response.on('close', resolve)
      source.pipe(response)
    })
  }
}
