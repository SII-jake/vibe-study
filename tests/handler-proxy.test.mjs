// DeepSeek 官方 Anthropic 端点的服务端代理规格：跳过配置，换密钥，原样透传 SSE
import { createServer } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import { createHandler } from '../server/handler.mjs'

function sseResponse(chunks) {
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
  return new Response(stream, { status: 200 })
}

const baseConfig = () => ({
  baseUrl: 'https://api.deepseek.com/v1',
  apiKey: '',
  model: 'deepseek-flash',
  models: [],
  serperKey: '',
  serperBase: '',
  jinaKey: '',
  jinaBase: '',
  deepseekKey: 'demo-deepseek-key',
  deepseekBase: 'https://api.deepseek.com',
  shellTools: false,
  auth: { enabled: false, password: '', cookie: 'vibe_auth', ttlDays: 30, secure: true },
})

async function serve(config, fetchImpl) {
  const server = createServer(createHandler(config, fetchImpl))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  return { base: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(r)) }
}

describe('POST /anthropic/v1/messages（DS 官方 Messages 代理）', () => {
  it('换密钥、原样透传请求体与 SSE 响应流', async () => {
    const upstreamBody = 'data: {"type":"message_start","message":{"id":"m1"}}\n\ndata: [DONE]\n\n'
    const fetchImpl = vi.fn(async (url, init) => {
      expect(String(url)).toBe('https://api.deepseek.com/anthropic/v1/messages')
      expect(init.headers['x-api-key']).toBe('demo-deepseek-key')
      expect(init.headers.Authorization).toBeUndefined()
      expect(init.headers['Content-Type']).toBe('application/json')
      // 请求体原样转发（不增删改）
      const body = JSON.parse(init.body)
      expect(body.model).toBe('deepseek-flash')
      expect(body.messages).toEqual([{ role: 'user', content: 'hi' }])
      return sseResponse([upstreamBody])
    })
    const running = await serve(baseConfig(), fetchImpl)
    const response = await fetch(`${running.base}/anthropic/v1/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': 'whatever-client-key' },
      body: JSON.stringify({ model: 'deepseek-flash', messages: [{ role: 'user', content: 'hi' }], stream: true }),
    })
    expect(response.status).toBe(200)
    const text = await response.text()
    expect(text).toContain('"type":"message_start"')
    expect(text).toContain('[DONE]')
    await running.close()
  })

  it('未配置 DeepSeek Key 时 503', async () => {
    const config = { ...baseConfig(), deepseekKey: '' }
    const fetchImpl = vi.fn()
    const running = await serve(config, fetchImpl)
    const response = await fetch(`${running.base}/anthropic/v1/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'deepseek-flash', messages: [{ role: 'user', content: 'hi' }] }),
    })
    expect(response.status).toBe(503)
    expect(fetchImpl).not.toHaveBeenCalled()
    await running.close()
  })

  it('代理路径不允许修改为非 POST', async () => {
    const running = await serve(baseConfig(), vi.fn())
    const response = await fetch(`${running.base}/anthropic/v1/messages`, { method: 'GET' })
    expect(response.status).toBe(404)
    await running.close()
  })
})
