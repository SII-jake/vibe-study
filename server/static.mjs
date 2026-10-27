import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { extname, join, normalize, sep } from 'node:path'
import { createGzip } from 'node:zlib'

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
 */
export function createStaticHandler(root) {
  const indexFile = join(root, 'index.html')

  return async function serveStatic(request, response) {
    const pathname = new URL(request.url, 'http://localhost').pathname

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
    // 带指纹的产物缺失就是缺失，不能回退成入口文件，否则浏览器会解析出错。
    const isAsset = pathname.startsWith('/assets/')
    const file = direct ?? (isAsset ? null : await readFileIfExists(indexFile))

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
