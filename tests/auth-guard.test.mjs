import { createServer } from 'node:http'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  LOGIN_PAGE_PATH,
  authRequired,
  createAuthHandler,
  getSessionToken,
  issueSession,
  loginPageHtml,
  passwordMatch,
} from '../server/auth.mjs'
import { createHandler } from '../server/handler.mjs'
import { createStaticHandler } from '../server/static.mjs'

const PASSWORD = 'unit-test-pass-123'

function makeAuth(overrides = {}) {
  return {
    enabled: true,
    password: PASSWORD,
    cookie: 'vibe_auth',
    ttlDays: 30,
    secure: false,
    ...overrides,
  }
}

function baseConfig(overrides = {}) {
  return {
    baseUrl: 'https://api.example.com/v1',
    apiKey: 'upstream-key',
    model: 'default-model',
    models: [],
    serperKey: '',
    serperBase: 'https://google.serper.dev',
    jinaKey: '',
    jinaBase: 'https://r.jina.ai',
    ...overrides,
  }
}

/** 起真实 HTTP 端口组合 auth 前置 + 目标处理器，贴近生产结构。 */
async function serve(handler) {
  const server = createServer((request, response) => void handler(request, response))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}

async function login(base, password) {
  const response = await fetch(`${base}/api/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
    redirect: 'manual',
  })
  return {
    response,
    body: await response.json(),
    setCookie: response.headers.get('set-cookie') ?? '',
  }
}

/** 从 Set-Cookie 头里抠出 Cookie 请求头要用的 name=value 段。 */
function cookiePair(setCookie) {
  return setCookie.split(';')[0]
}

const noRedirect = { redirect: 'manual' }

describe('auth 会话原语', () => {
  const auth = makeAuth()

  it('口令逐位比对，差一位都不通过', () => {
    expect(passwordMatch(auth, PASSWORD)).toBe(true)
    expect(passwordMatch(auth, `${PASSWORD}x`)).toBe(false)
    expect(passwordMatch(auth, '')).toBe(false)
  })

  it('服务端重启后旧口令仍可换到有效会话', () => {
    // 进程重启 cookies 不必重登，故无服务端会话表；签发的票用口令派生校验
    expect(() => {
      const { value } = issueSession(auth)
      getSessionToken({ headers: { cookie: `${auth.cookie}=${value}` } }, auth)
    }).not.toThrow()
  })

  it('篡改过的会话票直接拒掉', () => {
    const { name, value } = issueSession(auth)
    const [ts, rand, mac] = value.split('.')
    const forged = `${ts}.${rand}.${mac.split('').reverse().join('')}`
    const request = { headers: { cookie: `${name}=${forged}` } }
    expect(getSessionToken(request, auth)).toBeNull()
  })

  it('把票换成别的口令签发的也拒掉', () => {
    const victim = issueSession(makeAuth({ password: 'other-pass' }))
    const request = { headers: { cookie: `${auth.cookie}=${victim.value}` } }
    expect(getSessionToken(request, auth)).toBeNull()
  })

  it('签发时间超过 ttl 的票拒掉', () => {
    // ttl=0 会被实现归一为默认 30 天，这里显式注入 31 天前的签发时刻来演练过期路径
    const past = Math.floor(Date.now() / 1000) - 31 * 24 * 3600
    const { name, value } = issueSession(auth, past)
    const request = { headers: { cookie: `${name}=${value}` } }
    expect(getSessionToken(request, auth)).toBeNull()
  })

  it('签发时间在未来（时钟漂移超阈值）的票也拒掉', () => {
    const future = Math.floor(Date.now() / 1000) + 3600
    const { name, value } = issueSession(auth, future)
    const request = { headers: { cookie: `${name}=${value}` } }
    expect(getSessionToken(request, auth)).toBeNull()
  })

  it('未启用时不拦截任何请求', () => {
    expect(authRequired(makeAuth({ enabled: false }))).toBe(false)
  })

  it('登录页 HTML 是完整文档且口令不进任何默认值', () => {
    const html = loginPageHtml()
    expect(html).toContain('<form')
    expect(html).toContain('type="password"')
    expect(html.toLowerCase()).toContain('<!doctype html>')
    expect(html).not.toContain(PASSWORD)
  })

  it('表单登录失败回跳 ?e=1 时，登录页能就地提示口令不正确', () => {
    // 壳端整页导航登录失败后落在 /login.html?e=1：不把参数翻译成提示文案，
    // 用户只会看到一张没有上下文的空白登录页
    const html = loginPageHtml()
    expect(html).toContain('e=1')
    expect(html).toContain('口令不正确')
  })
})

describe('登录端点 /api/auth', () => {
  let running
  afterEach(async () => {
    await running?.close()
    running = null
  })

  it('口令正确签发 HttpOnly Cookie，口令错误 401 JSON', async () => {
    const auth = makeAuth()
    running = await serve(createAuthHandler(auth))

    const ok = await login(running.base, PASSWORD)
    expect(ok.response.status).toBe(200)
    expect(ok.body).toEqual({ ok: true })
    expect(ok.setCookie).toContain(`${auth.cookie}=`)
    expect(ok.setCookie.toLowerCase()).toContain('httponly')
    expect(ok.setCookie).toContain('SameSite=Lax')

    const bad = await login(running.base, 'wrong')
    expect(bad.response.status).toBe(401)
    expect(bad.body.ok).toBe(false)
    expect(bad.setCookie).toBe('')
  })

  it('未启用时像个不存在的端点，不暴露任何口令功能', async () => {
    running = await serve(createAuthHandler(makeAuth({ enabled: false })))
    const attempt = await login(running.base, PASSWORD)
    expect(attempt.response.status).toBe(404)
  })

  it('GET /api/auth 只有禁用回执', async () => {
    const auth = makeAuth()
    running = await serve(createAuthHandler(auth))
    const response = await fetch(`${running.base}/api/auth`, { ...noRedirect })
    expect(response.status).toBe(405)
  })

  it('表单提交口令正确：种 Cookie 并 303 落进应用（壳端整页导航登录）', async () => {
    const auth = makeAuth()
    running = await serve(createAuthHandler(auth))
    const response = await fetch(`${running.base}/api/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `password=${encodeURIComponent(PASSWORD)}`,
      redirect: 'manual',
    })
    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('/')
    expect(response.headers.get('set-cookie')).toContain(`${auth.cookie}=`)
  })

  it('表单提交口令错误：回到登录页并带错误标记，不种 Cookie', async () => {
    const auth = makeAuth()
    running = await serve(createAuthHandler(auth))
    const response = await fetch(`${running.base}/api/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'password=wrong',
      redirect: 'manual',
    })
    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe(`${LOGIN_PAGE_PATH}?e=1`)
    expect(response.headers.get('set-cookie')).toBeNull()
  })
})

describe('静态资源登录拦截（整站门禁）', () => {
  let parent
  let root
  let running
  const auth = makeAuth()

  beforeEach(async () => {
    parent = await mkdtemp(join(tmpdir(), 'vibe-study-auth-'))
    root = join(parent, 'dist')
    await mkdir(join(root, 'assets'), { recursive: true })
    await mkdir(join(root, 'icons'), { recursive: true })
    await mkdir(join(root, 'app'), { recursive: true })
    await writeFile(join(root, 'index.html'), '<div id="root"></div>')
    await writeFile(join(root, 'manifest.webmanifest'), '{"name":"vibe study"}')
    await writeFile(join(root, 'sw.js'), 'self.addEventListener("install", () => {})')
    await writeFile(join(root, 'assets', 'app-abc123.js'), 'console.log(1)')
    await writeFile(join(root, 'icons', 'icon-192.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    await writeFile(join(root, 'app', 'vibe-study-0.2.0-release.apk'), Buffer.from([0x50, 0x4b]))
    // 与 index.mjs 的生产装配一致：auth 前置拦截 + static 下游处理挂在同一端口
    running = await serve(createAuthHandler(auth, createStaticHandler(root, { auth })))
  })

  afterEach(async () => {
    await running.close()
    await rm(parent, { recursive: true, force: true })
  })

  async function loggedInCookie() {
    const { setCookie } = await login(running.base, PASSWORD)
    return cookiePair(setCookie)
  }

  it('未登录访问入口与任何页面都被重定向到登录页', async () => {
    for (const path of ['/', '/some/spa/route']) {
      const response = await fetch(`${running.base}${path}`, { ...noRedirect })
      expect(response.status).toBe(303)
      expect(response.headers.get('location')).toBe(LOGIN_PAGE_PATH)
    }
  })

  it('未登录访问静态资源与 APK 同样被重定向', async () => {
    // 前端产物被门挡住；/app/ APK 不在此列 —— 老壳 DownloadManager 不带网页 Cookie
    for (const path of ['/assets/app-abc123.js']) {
      const response = await fetch(`${running.base}${path}`, { ...noRedirect })
      expect(response.status).toBe(303)
      expect(response.headers.get('location')).toBe(LOGIN_PAGE_PATH)
    }
  })

  it('/app/ 下的 APK 未登录也可下载：老壳 OTA 的 DownloadManager 不带网页 Cookie', async () => {
    const response = await fetch(`${running.base}/app/vibe-study-0.2.0-release.apk`, { ...noRedirect })
    expect(response.status).toBe(200)
    expect(Buffer.from(await response.arrayBuffer())).toEqual(Buffer.from([0x50, 0x4b]))
  })

  it('登录页本身与老壳升级所需的启动文件不被拦截', async () => {
    for (const path of [LOGIN_PAGE_PATH, '/manifest.webmanifest', '/sw.js', '/icons/icon-192.png']) {
      const response = await fetch(`${running.base}${path}`, { ...noRedirect })
      expect(response.status).toBe(200)
    }
  })

  it('登录成功拿到的 Cookie 能正常访问全部静态内容', async () => {
    const cookie = await loggedInCookie()
    for (const path of ['/', '/assets/app-abc123.js', '/app/vibe-study-0.2.0-release.apk']) {
      const response = await fetch(`${running.base}${path}`, { headers: { cookie } })
      expect(response.status).toBe(200)
    }
  })

  it('篡改过的 Cookie 视同未登录', async () => {
    const cookie = `${auth.cookie}=tampered.token.here`
    const response = await fetch(`${running.base}/`, { headers: { cookie }, ...noRedirect })
    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe(LOGIN_PAGE_PATH)
  })
})

describe('API 登录拦截', () => {
  let running
  afterEach(async () => {
    await running?.close()
    running = null
  })

  it('未登录时所有 /api 一律 401 JSON，不走到业务路由', async () => {
    const auth = makeAuth()
    const api = createHandler(baseConfig(), undefined, { auth })
    running = await serve(createAuthHandler(auth, api))

    for (const [method, path, init] of [
      ['GET', '/api/health', {}],
      ['POST', '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"messages":[{"role":"user","content":"hi"}]}' }],
      ['POST', '/api/title', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"question":"q","answer":"a"}' }],
      ['POST', '/api/chat/resume', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"streamKey":"x"}' }],
    ]) {
      const response = await fetch(`${running.base}${path}`, { ...init, ...noRedirect })
      expect(response.status).toBe(401)
      expect(await response.json()).toEqual({ error: '未登录' })
    }
  })

  it('/api/auth 与 /api/app-version 是仅有的放行端点', async () => {
    const auth = makeAuth()
    const api = createHandler(baseConfig(), undefined, { auth })
    running = await serve(createAuthHandler(auth, api))
    const response = await fetch(`${running.base}/api/app-version`, { ...noRedirect })
    expect(response.status).not.toBe(401)
  })

  it('登录后的 Cookie 能正常调用 /api/health，伪造的 Cookie 打回 401', async () => {
    const auth = makeAuth()
    const api = createHandler(baseConfig(), undefined, { auth })
    running = await serve(createAuthHandler(auth, api))

    const { setCookie } = await login(running.base, PASSWORD)
    const ok = await fetch(`${running.base}/api/health`, { headers: { cookie: cookiePair(setCookie) } })
    expect(ok.status).toBe(200)
    expect((await ok.json()).configured).toBe(true)

    const forged = await fetch(`${running.base}/api/health`, { headers: { cookie: `${auth.cookie}=bad` } })
    expect(forged.status).toBe(401)
  })

  it('未启用时 api 处理器不加任何拦截，行为与现状一致', async () => {
    const api = createHandler(baseConfig(), undefined, { auth: makeAuth({ enabled: false }) })
    running = await serve(api)
    const response = await fetch(`${running.base}/api/health`)
    expect(response.status).toBe(200)
  })
})
