// 同步写口请求体上限（真机反馈 2026-11-22：远端 "H3多模态推理优化" 会话在
// 网页端与手机端内容不一致）。根因实证：
//   - 远端库 PUT 体 1,046,219 字节，服务端 MAX_BODY_BYTES = 1,048,576，余量仅 2,357；
//   - 超限时 readBody 直接 request.destroy()，客户端只看到 "fetch failed"，
//     前端 pushSessions 的 catch 静默吞掉 → 写入失败但毫无提示，另一端永远拿不到。
// 修复口径：①上限抬到 32MB；②超限回 413 JSON（不再销毁连接）；③前端暴露失败状态。
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

const nodeWith = (padBytes) => ({
  id: 'n1',
  title: 't',
  createdAt: 1,
  updatedAt: 1,
  messages: [
    { id: 'm1', role: 'user', content: 'x'.repeat(padBytes), files: [], createdAt: 1 },
  ],
})

async function serve({ maxBodyBytes } = {}) {
  const store = createNodeStore({ filePath: `/tmp/nodes-limit-${process.pid}-${Math.random()}.json` })
  const handler = createHandler(baseConfig(), fetch, {
    nodeStore: store,
    ...(maxBodyBytes === undefined ? {} : { maxBodyBytes }),
  })
  const server = createServer(handler)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  return { base, store, close: () => new Promise((r) => server.close(r)) }
}

const put = (base, node) =>
  fetch(`${base}/api/nodes`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ baseVersion: 0, nodes: [node] }),
  })

describe('A. 请求体上限抬升（1MB 卡死远端同步写口）', () => {
  it('超过 1MB 的 PUT 能成功写入——远端 H3 会话当前就已逼近 1MB', async () => {
    const { base, store, close } = await serve()
    try {
      // 1.5MB 请求体：修复前必然触发 destroy，修复后应正常落库
      const response = await put(base, nodeWith(1_500_000))
      expect(response.status).toBe(200)
      expect(store.getVersion()).toBe(1)
    } finally {
      await close()
    }
  })
})

describe('B. 超限必须是可读的 413，不再直接断连接', () => {
  it('超过上限回 413 JSON（客户端能拿到状态码，而不是 fetch failed）', async () => {
    const { base, close } = await serve({ maxBodyBytes: 1024 })
    try {
      // 断连时 fetch 会抛 TypeError；修复后应拿到一份正常响应
      const response = await put(base, nodeWith(4096))
      expect(response.status).toBe(413)
      const body = await response.json()
      expect(typeof body.error).toBe('string')
      expect(body.limit).toBe(1024)
    } finally {
      await close()
    }
  })

  it('未超限时照常写入（上限判定不误伤正常请求）', async () => {
    const { base, store, close } = await serve({ maxBodyBytes: 4096 })
    try {
      const response = await put(base, nodeWith(16))
      expect(response.status).toBe(200)
      expect(store.getVersion()).toBe(1)
    } finally {
      await close()
    }
  })
})
