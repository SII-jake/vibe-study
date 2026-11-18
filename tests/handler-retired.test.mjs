// 旧链路退役验收：/api/chat、/api/chat/resume、/api/title 随旧前端一起退场，一律 404。
// 新基座只消费 /api/nodes、/api/health、/anthropic/v1/messages 三条通道。
import { createServer } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import { createHandler } from '../server/handler.mjs'

const config = () => ({
  baseUrl: 'https://api.deepseek.com/v1',
  apiKey: '',
  model: 'deepseek-flash',
  models: [],
  serperKey: '',
  serperBase: '',
  jinaKey: '',
  jinaBase: '',
  deepseekKey: 'k',
  deepseekBase: 'https://api.deepseek.com',
  shellTools: true,
  auth: { enabled: false, password: '', cookie: 'vibe_auth', ttlDays: 30, secure: true },
})

async function serve(fetchImpl) {
  const server = createServer(createHandler(config(), fetchImpl))
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  return { base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) }
}

describe('旧链路路由退役', () => {
  it('POST /api/chat → 404', async () => {
    const running = await serve(vi.fn())
    const res = await fetch(`${running.base}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
    })
    expect(res.status).toBe(404)
    await running.close()
  })

  it('POST /api/chat/resume → 404', async () => {
    const running = await serve(vi.fn())
    const res = await fetch(`${running.base}/api/chat/resume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ streamKey: 'x' }),
    })
    expect(res.status).toBe(404)
    await running.close()
  })

  it('POST /api/title → 404', async () => {
    const running = await serve(vi.fn())
    const res = await fetch(`${running.base}/api/title`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: 'q', answer: 'a' }),
    })
    expect(res.status).toBe(404)
    await running.close()
  })

  it('保留通道不受影响：GET /api/health 仍 200', async () => {
    const running = await serve(vi.fn())
    const res = await fetch(`${running.base}/api/health`)
    expect(res.status).toBe(200)
    await running.close()
  })
})
