// 静态产物缺失时必须回 404，不能把 index.html 当成 CSS/JS 返回（2026-11-22 排查）。
// 现象：浏览器请求 /static/css/<旧hash>.css → 服务端回退成 index.html 但状态码 200、
// Content-Type text/html；配合 X-Content-Type-Options: nosniff，浏览器拒绝应用这份
// "CSS"，页面永久无样式，用户看到的就是"这个文件一直卡死/页面打不开"。
// 边界：SPA 前端路由（无扩展名的路径）仍要回 index.html，否则刷新深层路由会 404。
import { createServer } from 'node:http'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { createStaticHandler } from '../server/static.mjs'

const root = mkdtempSync(join(tmpdir(), 'vibe-static-'))
mkdirSync(join(root, 'static/css'), { recursive: true })
mkdirSync(join(root, 'static/js'), { recursive: true })
writeFileSync(join(root, 'index.html'), '<!doctype html><div id="root"></div>')
writeFileSync(join(root, 'static/css/main.real0001.css'), '.a{color:red}')
writeFileSync(join(root, 'static/js/main.real0001.js'), 'console.log(1)')

afterAll(() => rmSync(root, { recursive: true, force: true }))

async function serve() {
  const handler = createStaticHandler(root, { auth: { enabled: false } })
  const server = createServer((req, res) => {
    handler(req, res)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  return { base, close: () => new Promise((r) => server.close(r)) }
}

describe('静态产物缺失：回 404，不冒充 index.html', () => {
  it('存在的 css 正常返回 text/css', async () => {
    const { base, close } = await serve()
    try {
      const response = await fetch(`${base}/static/css/main.real0001.css`)
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toContain('text/css')
    } finally {
      await close()
    }
  })

  it('缺失的 css（旧 hash）回 404，不能返回 200 的 index.html', async () => {
    const { base, close } = await serve()
    try {
      const response = await fetch(`${base}/static/css/main.deadbeef.css`)
      expect(response.status).toBe(404)
      expect(response.headers.get('content-type') ?? '').not.toContain('text/html')
    } finally {
      await close()
    }
  })

  it('缺失的 js（旧 hash）同样回 404', async () => {
    const { base, close } = await serve()
    try {
      const response = await fetch(`${base}/static/js/main.deadbeef.js`)
      expect(response.status).toBe(404)
    } finally {
      await close()
    }
  })

  it('无扩展名的前端路由仍回 index.html（SPA 深层链接不能 404）', async () => {
    const { base, close } = await serve()
    try {
      const response = await fetch(`${base}/session/abc123`)
      expect(response.status).toBe(200)
      expect(await response.text()).toContain('id="root"')
    } finally {
      await close()
    }
  })
})
