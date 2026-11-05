// /api/app-version：壳内检查更新的唯一口径 —— 服务器上发布了哪个 APK。
// 数据归服务器自己的 static 目录（dist/app/），壳不读仓库、不猜默认值。
// 双版本口径：versionName 是壳版本，serverVersion 是服务端部署版本
// （发布脚本每次自增，读 dist/server-version.json，缺失时回壳版本兜底）。
import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createStaticHandler } from '../server/static.mjs'
import { createAppVersionHandler, readPublishedApk } from '../server/app-version.mjs'

let parent
let root
let server
let base

const APK_NAME = 'vibe-study-1.2.0-release.apk'
const APK_BODY = Buffer.from('fake-apk-content-for-hash')
const APK_SHA = createHash('sha256').update(APK_BODY).digest('hex')

beforeAll(async () => {
  parent = await mkdtemp(join(tmpdir(), 'vibe-study-appver-'))
  root = join(parent, 'dist')
  await mkdir(root, { recursive: true })
  await writeFile(join(root, 'index.html'), '<div id="root"></div>')

  const versionHandler = createAppVersionHandler(root)
  const staticHandler = createStaticHandler(root)
  server = createServer((request, response) => {
    const { pathname } = new URL(request.url, 'http://localhost')
    if (pathname === '/api/app-version') {
      void versionHandler(request, response)
      return
    }
    void staticHandler(request, response)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  base = `http://127.0.0.1:${address.port}`
})

afterAll(async () => {
  server.close()
  await rm(parent, { recursive: true, force: true })
})

/** 请求 /api/app-version 并解析 JSON 或状态码。 */
async function fetchVersion() {
  const response = await fetch(`${base}/api/app-version`)
  return { status: response.status, body: response.ok ? await response.json() : null }
}

async function publishApk(name = APK_NAME) {
  await mkdir(join(root, 'app'), { recursive: true })
  await writeFile(join(root, 'app', name), APK_BODY)
}

describe('readPublishedApk（dist/app/ 扫描口径）', () => {
  it('无 dist/app 目录时返回 null（壳静默放行）', async () => {
    expect(await readPublishedApk(root)).toBeNull()
  })

  it('发布 APK 后给出版本名、文件名与 SHA-256', async () => {
    await publishApk()
    const info = await readPublishedApk(root)
    expect(info.versionName).toBe('1.2.0')
    expect(info.apkName).toBe(APK_NAME)
    expect(info.sha256).toBe(APK_SHA)
  })
})

describe('GET /api/app-version', () => {
  it('有 APK 时返回版本、文件名、SHA-256 整串', async () => {
    // 沿用上个用例已发布的 APK
    const { status, body } = await fetchVersion()
    expect(status).toBe(200)
    expect(body.versionName).toBe('1.2.0')
    expect(body.apkName).toBe(APK_NAME)
    expect(body.sha256).toBe(APK_SHA)
    expect(body.versionCode).toBeGreaterThanOrEqual(1)
  })

  it('dist/server-version.json 存在时 serverVersion 读它', async () => {
    await writeFile(join(root, 'server-version.json'), JSON.stringify({ version: '1.2.0.7' }))
    const { status, body } = await fetchVersion()
    expect(status).toBe(200)
    expect(body.serverVersion).toBe('1.2.0.7')
    await rm(join(root, 'server-version.json'), { force: true })
  })

  it('缺 server-version.json 时 serverVersion 回退壳版本', async () => {
    const { body } = await fetchVersion()
    expect(body.serverVersion).toBe('1.2.0')
  })

  it('无 APK（纯前端发布）也回 serverVersion，不 404 装死', async () => {
    await rm(join(root, 'app'), { recursive: true, force: true })
    await writeFile(join(root, 'server-version.json'), JSON.stringify({ version: '1.2.0.9' }))
    // fetchVersion helper 对非 ok 不给 body，这里要验证的正是 404 响应里的字段，自行解析
    const response = await fetch(`${base}/api/app-version`)
    const body = await response.json()
    const status = response.status
    expect(status).toBe(404)
    expect(body.serverVersion).toBe('1.2.0.9')
    await rm(join(root, 'server-version.json'), { force: true })
    await publishApk()
  })

  it('不带版本号的 APK 文件名按 versionName 0.0.0 兜底', async () => {
    await rm(join(root, 'app'), { recursive: true, force: true })
    await publishApk('nightly.apk')
    const { body } = await fetchVersion()
    expect(body.versionName).toBe('0.0.0')
    // 恢复标准产物，供后续用例使用
    await rm(join(root, 'app'), { recursive: true, force: true })
    await publishApk()
  })
})

describe('跨源访问（壳 WebView 源是 https://localhost）', () => {
  // 真机回归：启动页 fetch 版本接口被 CORS 拒时 checkAppUpdate 静默放行，
  // 启动页没有任何更新提示。版本接口（且只有它）需要允许任意源——
  // 任何服务器地址都可能服务任何一台手机的壳。
  it('200 响应带 Access-Control-Allow-Origin', async () => {
    const response = await fetch(`${base}/api/app-version`, {
      headers: { Origin: 'https://localhost' },
    })
    expect(response.status).toBe(200)
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
  })

  it('404（未发布）同样带 Access-Control-Allow-Origin，壳能读到 404 状态', async () => {
    await rm(join(root, 'app'), { recursive: true, force: true })
    const response = await fetch(`${base}/api/app-version`, {
      headers: { Origin: 'https://localhost' },
    })
    expect(response.status).toBe(404)
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
    await publishApk()
  })
})

describe('APK 文件的静态分发（下载本身走 static）', () => {
  it('GET /app/<apkName> 能拿到与版本信息一致的字节', async () => {
    const response = await fetch(`${base}/app/${APK_NAME}`)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/vnd.android.package-archive')
    const bytes = Buffer.from(await response.arrayBuffer())
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(APK_SHA)
  })
})
