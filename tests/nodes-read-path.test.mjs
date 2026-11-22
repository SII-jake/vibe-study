// 同步读口传输优化（2026-11-22 实测：远端 "H3多模态推理优化" 会话涨到 153 条消息后，
// 整库 GET /api/nodes 响应体 2,244,092 字节、未压缩、无 304，公网出网带宽约 180 KB/s，
// 每次整棵拉取要 10.9~12.3 秒；切回标签页/窗口聚焦都会新起一次，主线程被占满，
// 任何新的 css/js 请求都排在后面等，观感就是"这个 css 一直卡死"）。
// 三处改动：①响应 gzip（实测 2.24MB → 0.99MB，省 56%）②版本未变回 304
// ③前端并发守卫（另一条测试文件）。这里固定服务端两条。
import { createServer } from 'node:http'
import { describe, expect, it } from 'vitest'
import { createHandler } from '../server/handler.mjs'
import { createNodeStore } from '../server/node-store.mjs'

const baseConfig = () => ({
  baseUrl: 'https://api.deepseek.com/v1',
  apiKey: '',
  model: 'deepseek-flash',
  models: [],
  serperKey: '',
  serperBase: '',
  jinaKey: '',
  jinaBase: '',
  deepseekKey: 'demo-key',
  deepseekBase: 'https://api.deepseek.com',
  shellTools: false,
  auth: { enabled: false, password: '', cookie: 'vibe_auth', ttlDays: 30, secure: true },
})

/** 造一份足够大的库：gzip 阈值与真实场景同量级。 */
const bigNodes = (count = 400) =>
  Array.from({ length: count }, (_, i) => ({
    id: `n${i}`,
    title: `话题${i}`,
    createdAt: i,
    updatedAt: i,
    messages: [{ id: `m${i}`, role: 'user', content: '问'.repeat(500), files: [], createdAt: i }],
  }))

async function serve(nodes) {
  const store = createNodeStore({ filePath: `/tmp/nodes-read-${process.pid}-${Math.random()}.json` })
  store.save(nodes, 0)
  const handler = createHandler(baseConfig(), fetch, { nodeStore: store })
  const server = createServer(handler)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) }
}

describe('GET /api/nodes 传输优化', () => {
  it('带 Accept-Encoding: gzip 时响应压缩，解压后仍是完整 JSON', async () => {
    const { base, close } = await serve(bigNodes())
    try {
      const response = await fetch(`${base}/api/nodes`, {
        headers: { 'Accept-Encoding': 'gzip' },
      })
      expect(response.status).toBe(200)
      expect(response.headers.get('content-encoding')).toBe('gzip')
      // undici 会按 content-encoding 自动解压，读到的仍是原 JSON
      const body = await response.json()
      expect(body.nodes).toHaveLength(400)
      expect(body.version).toBe(1)
    } finally {
      await close()
    }
  })

  it('不带 Accept-Encoding 时不压缩，并给出准确长度', async () => {
    const { base, close } = await serve(bigNodes())
    try {
      const response = await fetch(`${base}/api/nodes`, { headers: { 'Accept-Encoding': 'identity' } })
      expect(response.status).toBe(200)
      expect(response.headers.get('content-encoding')).toBeNull()
      const length = Number(response.headers.get('content-length'))
      expect(length).toBeGreaterThan(1000)
      expect(JSON.parse(await response.text()).nodes).toHaveLength(400)
    } finally {
      await close()
    }
  })

  it('响应带 ETag，版本号未变时携带 If-None-Match 回 304 且无响应体', async () => {
    const { base, close } = await serve(bigNodes())
    try {
      const first = await fetch(`${base}/api/nodes`)
      const etag = first.headers.get('etag')
      expect(etag).toBeTruthy()
      await first.arrayBuffer()

      const second = await fetch(`${base}/api/nodes`, { headers: { 'If-None-Match': etag } })
      expect(second.status).toBe(304)
      expect((await second.arrayBuffer()).byteLength).toBe(0)
    } finally {
      await close()
    }
  })

  it('版本变化后同一个 ETag 不再命中 304', async () => {
    const { base, close } = await serve(bigNodes(10))
    try {
      const first = await fetch(`${base}/api/nodes`)
      const etag = first.headers.get('etag')
      await first.arrayBuffer()
      // 写入新版本
      const put = await fetch(`${base}/api/nodes`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseVersion: 1, nodes: bigNodes(11) }),
      })
      expect(put.status).toBe(200)
      const again = await fetch(`${base}/api/nodes`, { headers: { 'If-None-Match': etag } })
      expect(again.status).toBe(200)
      expect((await again.json()).nodes).toHaveLength(11)
    } finally {
      await close()
    }
  })
})
