/**
 * 访问口令登录门卫：服务要暴露到公网时，不能让陌生人白嫖上游模型额度。
 *
 * 设计口径：
 * - 单口令（ACCESS_PASSWORD），服务端内存里只存口令本身；会话票用口令派生
 *   校验，无服务端会话表 —— 进程重启后旧 Cookie 仍然有效，自用场景不用频繁重登。
 * - 会话票 = `${签发秒}.${随机值}.${HMAC}`，HMAC 以口令为 key 覆盖前两者；
 *   改口令即全局下线所有已签发票。
 * - 未配置口令时 auth.enabled = false，所有拦截逻辑关闭，行为与未引入本模块前一致。
 * - 本模块只做纯函数与拦截判定，HTTP 接线落在 handler.mjs / static.mjs。
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

export const LOGIN_PAGE_PATH = '/login.html'

/** 未登录也要放行的路径：登录页自身 + PWA/老壳启动必需文件。 */
const PUBLIC_PATHS = new Set([
  LOGIN_PAGE_PATH,
  '/manifest.webmanifest',
  '/sw.js',
  '/favicon.ico',
])

/** 未登录也要放行的路径前缀：老壳安装/更新检查走的图标与 APK 下载。 */
const PUBLIC_PREFIXES = ['/icons/', '/app/']

/** API 侧未登录放行端点：登录接口本身 + 老壳 OTA 版本检查（DownloadManager 不带网页 Cookie）。 */
const PUBLIC_API_PATHS = new Set(['/api/auth', '/api/app-version'])

const DAY_SECONDS = 24 * 3600

export function authRequired(auth) {
  return auth?.enabled === true
}

/** 逐位常量时间比对口令；不短路，避免拼长度/前缀的旁路猜测。 */
export function passwordMatch(auth, candidate) {
  const expected = Buffer.from(String(auth.password), 'utf8')
  const actual = Buffer.from(String(candidate ?? ''), 'utf8')
  if (expected.length !== actual.length) return timingSafeEqual(expected, expected) && false
  return timingSafeEqual(expected, actual)
}

function sign(auth, payload) {
  return createHmac('sha256', String(auth.password)).update(payload).digest('base64url')
}

/** 签发一条会话 Cookie：{ name, value, attributes }；atSeconds 仅供测试注入签发时刻。 */
export function issueSession(auth, atSeconds) {
  const issuedAt = atSeconds ?? Math.floor(Date.now() / 1000)
  const rand = randomBytes(16).toString('base64url')
  const value = `${issuedAt}.${rand}.${sign(auth, `${issuedAt}.${rand}`)}`
  const maxAge = Math.max(1, Math.round((auth.ttlDays ?? 30) * DAY_SECONDS))
  const attributes = [
    `Path=/`,
    `Max-Age=${maxAge}`,
    'HttpOnly',
    'SameSite=Lax',
    auth.secure ? 'Secure' : null,
  ]
    .filter(Boolean)
    .join('; ')
  return { name: auth.cookie, value, attributes }
}

function readCookie(request, name) {
  const header = request?.headers?.cookie
  if (typeof header !== 'string') return null
  for (const part of header.split(';')) {
    const separator = part.indexOf('=')
    if (separator < 0) continue
    if (part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim()
  }
  return null
}

/** 校验请求携带的会话票；合法返回票面值，非法/过期/未配置返回 null。 */
export function getSessionToken(request, auth) {
  if (!authRequired(auth)) return null
  const value = readCookie(request, auth.cookie)
  if (!value) return null
  const [issuedAtRaw, rand, mac] = value.split('.')
  if (!issuedAtRaw || !rand || !mac) return null

  const expected = Buffer.from(sign(auth, `${issuedAtRaw}.${rand}`), 'utf8')
  const actual = Buffer.from(mac, 'utf8')
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null

  const issuedAt = Number(issuedAtRaw)
  if (!Number.isFinite(issuedAt)) return null
  const nowSeconds = Math.floor(Date.now() / 1000)
  const maxAge = Math.max(1, Math.round((auth.ttlDays ?? 30) * DAY_SECONDS))
  // 未来签发的票也一并拒掉：宁可让用戶重登，不给伪造时间戳留口子
  if (issuedAt > nowSeconds + 60) return null
  if (issuedAt + maxAge < nowSeconds) return null
  return value
}

/** 静态侧：未登录是否放行（登录页与 PWA/老壳启动必需件）。 */
export function isPublicPath(pathname) {
  if (PUBLIC_PATHS.has(pathname)) return true
  return PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix))
}

/** API 侧：未登录是否放行（登录端点与老壳 OTA 检查）。 */
export function isPublicApiPath(pathname) {
  return PUBLIC_API_PATHS.has(pathname)
}

/** 导出门最终判定：静态请求是否需要登录。 */
export function staticNeedsAuth(request, auth, pathname) {
  if (!authRequired(auth)) return false
  if (isPublicPath(pathname)) return false
  return getSessionToken(request, auth) === null
}

/**
 * 导出门最终判定：API 请求是否需要登录。
 * 非 /api 路径返回 false —— 本判定只守 API；静态路径由 staticNeedsAuth 负责，
 * 否则登录页之前连首页访问都会被回 401 JSON 而不是 302 引导到登录页。
 */
export function apiNeedsAuth(request, auth, pathname) {
  if (!authRequired(auth)) return false
  if (pathname !== '/api' && !pathname.startsWith('/api/')) return false
  if (isPublicApiPath(pathname)) return false
  return getSessionToken(request, auth) === null
}

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload)
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  })
  response.end(body)
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    request.on('data', (chunk) => {
      size += chunk.length
      if (size > 64 * 1024) {
        reject(new Error('请求体过大'))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        reject(new Error('请求体不是合法 JSON'))
      }
    })
    request.on('error', reject)
  })
}

/**
 * /api/auth 登录端点 + 前置拦截器。
 *
 * 用法：createServer((req, res) => authHandler(req, res))；命中 /api/auth 时
 * 自行处理登录并返回 true；其余请求做登录拦截，通过后交给 next 处理器。
 * 未启用时透传一切 —— 端点也当作不存在（404 由下游兜底报未知路径）。
 */
export function createAuthHandler(auth, next) {
  return async function authHandler(request, response) {
    const { pathname } = new URL(request.url, 'http://localhost')

    if (pathname === '/api/auth') {
      if (!authRequired(auth)) {
        sendJson(response, 404, { error: '未知路径' })
        return true
      }
      if (request.method !== 'POST') {
        sendJson(response, 405, { error: '方法不被允许' })
        return true
      }
      let payload
      try {
        payload = await readJsonBody(request)
      } catch (cause) {
        sendJson(response, 400, { error: cause.message })
        return true
      }
      if (!passwordMatch(auth, payload?.password)) {
        sendJson(response, 401, { ok: false, error: '口令不正确' })
        return true
      }
      const session = issueSession(auth)
      // Set-Cookie 必须先于 writeHead 落到响应头，否则头一发出就补不上了
      response.setHeader('Set-Cookie', `${session.name}=${session.value}; ${session.attributes}`)
      sendJson(response, 200, { ok: true })
      return true
    }

    if (apiNeedsAuth(request, auth, pathname)) {
      sendJson(response, 401, { error: '未登录' })
      return true
    }

    return next ? (await next(request, response)) !== false : false
  }
}

/**
 * 登录页 HTML：无构建依赖的静态页面，口令只在表单里由用户手工输入。
 * 文案保持中性，不暴露站点用途。
 */
export function loginPageHtml() {
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="dark" />
    <title>登录</title>
    <style>
      * { box-sizing: border-box; }
      body {
        margin: 0; min-height: 100vh; display: grid; place-items: center;
        background: #0a0a0b; color: #d8d8db;
        font: 15px/1.6 -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
      }
      form {
        width: min(320px, 90vw); display: grid; gap: 12px; padding: 28px 24px;
        background: #131316; border: 1px solid #232327; border-radius: 12px;
      }
      h1 { margin: 0 0 4px; font-size: 17px; font-weight: 600; text-align: center; }
      input {
        width: 100%; padding: 10px 12px; color: inherit;
        background: #0a0a0b; border: 1px solid #2e2e33; border-radius: 8px; outline: none;
      }
      input:focus { border-color: #4a6cf7; }
      button {
        padding: 10px 12px; border: 0; border-radius: 8px; cursor: pointer;
        background: #4a6cf7; color: #fff; font-size: 15px;
      }
      button:disabled { opacity: .6; cursor: default; }
      #msg { min-height: 1.4em; margin: 0; font-size: 13px; color: #e06c75; text-align: center; }
    </style>
  </head>
  <body>
    <form id="f">
      <h1>vibe study</h1>
      <input id="p" type="password" autocomplete="current-password" placeholder="访问口令" autofocus />
      <button id="b" type="submit">进入</button>
      <p id="msg"></p>
    </form>
    <script>
      var f = document.getElementById('f'), p = document.getElementById('p'),
          b = document.getElementById('b'), msg = document.getElementById('msg');
      f.addEventListener('submit', function (e) {
        e.preventDefault();
        if (!p.value) { msg.textContent = '请输入访问口令'; return; }
        b.disabled = true; msg.textContent = '';
        fetch('/api/auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: p.value })
        }).then(function (r) {
          if (r.ok) { location.replace('/'); return; }
          msg.textContent = r.status === 401 ? '口令不正确' : ('服务异常（' + r.status + '）');
        }).catch(function () {
          msg.textContent = '网络异常，请重试';
        }).finally(function () { b.disabled = false; });
      });
    </script>
  </body>
</html>
`
}
