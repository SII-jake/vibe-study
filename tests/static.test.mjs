import { createServer } from 'node:http'
import { connect } from 'node:net'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createStaticHandler } from '../server/static.mjs'

let parent
let root
let server
let base

beforeAll(async () => {
  parent = await mkdtemp(join(tmpdir(), 'vibe-study-deploy-'))
  root = join(parent, 'dist')
  await mkdir(root, { recursive: true })
  await writeFile(join(root, 'index.html'), '<div id="root"></div>')
  await writeFile(join(root, 'sw.js'), 'self.addEventListener("install", () => {})')
  await writeFile(join(root, 'manifest.webmanifest'), '{"name":"vibe study"}')
  await mkdir(join(root, 'assets'), { recursive: true })
  await writeFile(join(root, 'assets', 'app-abc123.js'), 'console.log(1)')
  await mkdir(join(root, 'icons'), { recursive: true })
  await writeFile(join(root, 'icons', 'icon-192.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  // 部署根目录之外的同级敏感文件，用于验证穿越防护
  await writeFile(join(parent, 'secret.txt'), 'TOP SECRET')

  const handler = createStaticHandler(root)
  server = createServer((request, response) => void handler(request, response))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${server.address().port}`
})

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve))
  await rm(parent, { recursive: true, force: true })
})

describe('静态资源服务', () => {
  it('根路径交付入口文件且不缓存', async () => {
    const response = await fetch(`${base}/`)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/html')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.text()).toContain('id="root"')
  })

  it('前端路由回退到入口文件', async () => {
    const response = await fetch(`${base}/n/abc123`)
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('id="root"')
  })

  it('带指纹的产物长缓存且 MIME 正确', async () => {
    const response = await fetch(`${base}/assets/app-abc123.js`)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/javascript')
    expect(response.headers.get('cache-control')).toContain('immutable')
  })

  it('缺失的产物返回 404，不回退成首页', async () => {
    const response = await fetch(`${base}/assets/missing-xyz.js`)
    expect(response.status).toBe(404)
  })

  it('webmanifest 用清单 MIME 类型', async () => {
    const response = await fetch(`${base}/manifest.webmanifest`)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/manifest+json')
  })

  it('离线脚本不缓存', async () => {
    const response = await fetch(`${base}/sw.js`)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('图片按二进制交付', async () => {
    const response = await fetch(`${base}/icons/icon-192.png`)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/png')
  })

  it('拒绝目录穿越', async () => {
    // 用原始 socket 发出未经客户端归一化的路径，才能真实检验服务端防护
    const raw = await rawGet(`/../../secret.txt`)
    expect(raw).not.toContain('TOP SECRET')
  })

  it('拒绝含空字节的路径', async () => {
    const raw = await rawGet(`/index.html%00.png`)
    expect(raw).not.toContain('TOP SECRET')
  })

  it('声明支持 gzip 时压缩文本资源', async () => {
    const response = await fetch(`${base}/assets/app-abc123.js`, {
      headers: { 'Accept-Encoding': 'gzip' },
    })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-encoding')).toBe('gzip')
    expect(await response.text()).toBe('console.log(1)')
  })

  it('未声明 gzip 时不压缩', async () => {
    const response = await fetch(`${base}/assets/app-abc123.js`, {
      headers: { 'Accept-Encoding': 'identity' },
    })
    expect(response.headers.get('content-encoding')).toBeNull()
  })

  it('图片不压缩', async () => {
    const response = await fetch(`${base}/icons/icon-192.png`, {
      headers: { 'Accept-Encoding': 'gzip' },
    })
    expect(response.headers.get('content-encoding')).toBeNull()
  })
})

/** 直接连 socket 发请求，绕开 fetch/URL 对路径的归一化。 */
function rawGet(path) {
  const { port } = new URL(base)
  return new Promise((resolve, reject) => {
    const socket = connect(Number(port), '127.0.0.1', () => {
      socket.write(`GET ${path} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n`)
    })
    let data = ''
    socket.on('data', (chunk) => {
      data += chunk.toString('utf8')
    })
    socket.on('end', () => resolve(data))
    socket.on('error', reject)
  })
}
