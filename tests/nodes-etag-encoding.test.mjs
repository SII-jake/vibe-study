// ETag 必须区分内容编码，且所有响应都带 Vary: Accept-Encoding。
//
// 2026-11-22 真机 Debug 窗口：GET /api/nodes (failed) net::ERR_CONTENT_LENGTH_MISMATCH。
// 根因是上一批引入 gzip 时的缺陷：ETag 只由版本号决定，gzip 与 identity 两个
// 体积差 2.24 倍（999,743 vs 2,244,092 字节）的表示共用同一个 ETag "nodes-60"，
// 且 identity 的 200 与 304 都缺 Vary: Accept-Encoding。浏览器缓存按 URL 存条目，
// 遇到同一 ETag 的两个编码变体时用错了长度校验基准 → ERR_CONTENT_LENGTH_MISMATCH。
//
// RFC 9110 §8.8.1：内容编码是"所选表示"的一部分，不同编码的表示必须有不同的
// 实体标签。RFC 9110 §12.5.5：Vary 用来说明选择表示的请求头，条件请求与缓存
// 都必须看到它——304 也要带。
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

const bigNodes = (count = 400) =>
  Array.from({ length: count }, (_, i) => ({
    id: `n${i}`,
    title: `话题${i}`,
    createdAt: i,
    updatedAt: i,
    messages: [{ id: `m${i}`, role: 'user', content: '问'.repeat(500), files: [], createdAt: i }],
  }))

async function serve(nodes) {
  const store = createNodeStore({ filePath: `/tmp/nodes-etag-${process.pid}-${Math.random()}.json` })
  store.save(nodes, 0)
  const handler = createHandler(baseConfig(), fetch, { nodeStore: store })
  const server = createServer(handler)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) }
}

const get = (base, headers) => fetch(`${base}/api/nodes`, { headers })

describe('ETag 与 Vary 必须区分内容编码', () => {
  it('gzip 与 identity 响应的 ETag 不同（同一 ETag 跨编码会让浏览器长度校验错乱）', async () => {
    const { base, close } = await serve(bigNodes())
    try {
      const gz = await get(base, { 'Accept-Encoding': 'gzip' })
      const id = await get(base, { 'Accept-Encoding': 'identity' })
      await gz.arrayBuffer()
      await id.arrayBuffer()
      const gzTag = gz.headers.get('etag')
      const idTag = id.headers.get('etag')
      expect(gzTag).toBeTruthy()
      expect(idTag).toBeTruthy()
      expect(gzTag).not.toBe(idTag)
    } finally {
      await close()
    }
  })

  it('gzip 与 identity 的两个 ETag 各自都能命中自己的 304', async () => {
    const { base, close } = await serve(bigNodes())
    try {
      const gz = await get(base, { 'Accept-Encoding': 'gzip' })
      const gzTag = gz.headers.get('etag')
      await gz.arrayBuffer()
      const id = await get(base, { 'Accept-Encoding': 'identity' })
      const idTag = id.headers.get('etag')
      await id.arrayBuffer()

      const gzHit = await get(base, { 'Accept-Encoding': 'gzip', 'If-None-Match': gzTag })
      expect(gzHit.status).toBe(304)
      const idHit = await get(base, { 'Accept-Encoding': 'identity', 'If-None-Match': idTag })
      expect(idHit.status).toBe(304)
    } finally {
      await close()
    }
  })

  it('用 gzip 的 ETag 在 identity 请求上不能误命中 304', async () => {
    const { base, close } = await serve(bigNodes())
    try {
      const gz = await get(base, { 'Accept-Encoding': 'gzip' })
      const gzTag = gz.headers.get('etag')
      await gz.arrayBuffer()
      // 同一个标签用在另一种编码上：必须回 200 全量，不能回 304
      const wrong = await get(base, { 'Accept-Encoding': 'identity', 'If-None-Match': gzTag })
      expect(wrong.status).toBe(200)
      expect(Number(wrong.headers.get('content-length'))).toBeGreaterThan(1000)
      await wrong.arrayBuffer()
    } finally {
      await close()
    }
  })

  it('gzip 的 200、identity 的 200、以及 304 都带 Vary: Accept-Encoding', async () => {
    const { base, close } = await serve(bigNodes())
    try {
      const gz = await get(base, { 'Accept-Encoding': 'gzip' })
      expect(gz.headers.get('vary') ?? '').toContain('Accept-Encoding')
      await gz.arrayBuffer()

      const id = await get(base, { 'Accept-Encoding': 'identity' })
      expect(id.headers.get('vary') ?? '').toContain('Accept-Encoding')
      await id.arrayBuffer()

      const hit = await get(base, { 'Accept-Encoding': 'gzip', 'If-None-Match': gz.headers.get('etag') })
      expect(hit.status).toBe(304)
      expect(hit.headers.get('vary') ?? '').toContain('Accept-Encoding')
    } finally {
      await close()
    }
  })

  it('明确声明不支持 Range：带 Range 的请求回 200 全量且声明 Accept-Ranges: none', async () => {
    const { base, close } = await serve(bigNodes())
    try {
      const response = await get(base, { Range: 'bytes=100-200' })
      // JSON 快照不做分段传输；服务器可以忽略 Range，但必须让客户端知道别再试
      expect(response.status).toBe(200)
      expect(response.headers.get('accept-ranges')).toBe('none')
      await response.arrayBuffer()
    } finally {
      await close()
    }
  })
})

describe('ETag 标签必须与响应实际编码一致（小体积不压缩的边界）', () => {
  it('库体积小于压缩阈值时，响应不压缩且 ETag 不带 -gzip 后缀', async () => {
    // 只有一条极短会话：body 远小于 GZIP_MIN_BYTES(1024)
    const { base, close } = await serve([{ id: 'tiny', title: '', createdAt: 0, updatedAt: 0, messages: [] }])
    try {
      const response = await get(base, { 'Accept-Encoding': 'gzip' })
      expect(response.status).toBe(200)
      expect(response.headers.get('content-encoding')).toBeNull()
      expect(response.headers.get('etag') ?? '').not.toContain('gzip')
      await response.arrayBuffer()
    } finally {
      await close()
    }
  })

  it('大体积压缩时 ETag 带 -gzip 后缀，两种表示标签不冲突', async () => {
    const { base, close } = await serve(bigNodes())
    try {
      const gz = await get(base, { 'Accept-Encoding': 'gzip' })
      expect(gz.headers.get('content-encoding')).toBe('gzip')
      expect(gz.headers.get('etag') ?? '').toContain('gzip')
      await gz.arrayBuffer()
    } finally {
      await close()
    }
  })
})
