import { createServer } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHandler } from '../server/handler.mjs'
import { computeStreamKey } from '../server/stream-store.mjs'
import { loadServerConfig, parseEnvFile } from '../server/config.mjs'

const KEY = 'sk-test-secret-key'

function baseConfig(overrides = {}) {
  return {
    baseUrl: 'https://api.example.com/v1',
    apiKey: KEY,
    model: 'default-model',
    models: [],
    serperKey: '',
    serperBase: 'https://google.serper.dev',
    jinaKey: '',
    jinaBase: 'https://r.jina.ai',
    ...overrides,
  }
}

/** 起一个真实 HTTP 端口，避免用假的 req/res 掩盖流式行为。 */
async function serve(config, fetchImpl) {
  const handler = createHandler(config, fetchImpl)
  const server = createServer(handler)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}

function sseStream(chunks) {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)))
      controller.close()
    },
  })
}

let running = null

afterEach(async () => {
  if (running) {
    await running.close()
    running = null
  }
})

describe('parseEnvFile', () => {
  it('解析键值对并忽略注释与空行', () => {
    const parsed = parseEnvFile('# 注释\nAI_MODEL=deepseek-chat\n\nAI_API_KEY=abc\n')
    expect(parsed).toEqual({ AI_MODEL: 'deepseek-chat', AI_API_KEY: 'abc' })
  })

  it('去掉值两端的引号与空白', () => {
    expect(parseEnvFile('AI_API_KEY="  x  "\n')).toEqual({ AI_API_KEY: 'x' })
  })
})

describe('loadServerConfig', () => {
  it('从环境变量读取上游地址、密钥与模型', () => {
    const config = loadServerConfig({
      AI_BASE_URL: 'https://api.deepseek.com/',
      AI_API_KEY: ' k ',
      AI_MODEL: ' deepseek-chat ',
    })
    expect(config).toMatchObject({
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: 'k',
      model: 'deepseek-chat',
    })
  })

  it('模型白名单按逗号拆分', () => {
    const config = loadServerConfig({ AI_MODELS: 'a, b ,c' })
    expect(config.models).toEqual(['a', 'b', 'c'])
  })
})

describe('GET /api/health', () => {
  it('只报告是否就绪与可选模型，绝不返回密钥', async () => {
    running = await serve(baseConfig({ models: ['a', 'b'] }))
    const response = await fetch(`${running.base}/api/health`)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({ configured: true, model: 'default-model', models: ['a', 'b'] })
    expect(JSON.stringify(body)).not.toContain(KEY)
  })

  it('未配置密钥时 configured 为 false', async () => {
    running = await serve(baseConfig({ apiKey: '' }))
    const body = await (await fetch(`${running.base}/api/health`)).json()
    expect(body.configured).toBe(false)
  })
})

describe('POST /api/chat', () => {
  it('注入服务端密钥并把上游增量原样转回', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        sseStream([
          'data: {"choices":[{"delta":{"content":"复利"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"是"}}]}\n\n',
          'data: [DONE]\n\n',
        ]),
        { status: 200 },
      ),
    )
    running = await serve(baseConfig(), fetchImpl)

    const response = await fetch(`${running.base}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
    })
    const text = await response.text()

    expect(response.status).toBe(200)
    expect(text).toContain('"content":"复利"')
    expect(text).toContain('[DONE]')

    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe('https://api.example.com/v1/chat/completions')
    expect(init.headers.Authorization).toBe(`Bearer ${KEY}`)
    expect(JSON.parse(init.body)).toMatchObject({ model: 'default-model', stream: true })
  })

  it('响应体里不出现密钥', async () => {
    const fetchImpl = async () =>
      new Response(sseStream(['data: {"choices":[{"delta":{"content":"ok"}}]}\n\n']), { status: 200 })
    running = await serve(baseConfig(), fetchImpl)
    const text = await (
      await fetch(`${running.base}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
      })
    ).text()
    expect(text).not.toContain(KEY)
  })

  it('客户端指定的模型在白名单内时采用，否则回落到默认模型', async () => {
    const fetchImpl = vi.fn(async () => new Response(sseStream(['data: [DONE]\n\n']), { status: 200 }))
    running = await serve(baseConfig({ models: ['allowed-model'] }), fetchImpl)

    await (await fetch(`${running.base}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'x' }], model: 'allowed-model' }),
    })).text()
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).model).toBe('allowed-model')

    await (await fetch(`${running.base}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'x' }], model: 'evil-model' }),
    })).text()
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body).model).toBe('default-model')
  })

  it('未配置密钥时返回 503 且不请求上游', async () => {
    const fetchImpl = vi.fn()
    running = await serve(baseConfig({ apiKey: '' }), fetchImpl)
    const response = await fetch(`${running.base}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
    })
    expect(response.status).toBe(503)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('messages 缺失或不是数组时返回 400', async () => {
    running = await serve(baseConfig(), vi.fn())
    const response = await fetch(`${running.base}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: 'nope' }),
    })
    expect(response.status).toBe(400)
  })

  it('上游报错时透传状态码并把错误体交回客户端', async () => {
    const fetchImpl = async () => new Response('{"error":"invalid key"}', { status: 401 })
    running = await serve(baseConfig(), fetchImpl)
    const response = await fetch(`${running.base}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
    })
    expect(response.status).toBe(401)
    expect(await response.text()).toContain('invalid key')
  })

  it('未知路径返回 404', async () => {
    running = await serve(baseConfig(), vi.fn())
    expect((await fetch(`${running.base}/api/unknown`)).status).toBe(404)
  })
})

describe('POST /api/chat（agent 模式，配置工具密钥后）', () => {
  const TOOL_CALL = {
    choices: [
      {
        finish_reason: 'tool_calls',
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            { id: 'call_9', type: 'function', function: { name: 'search', arguments: '{"query":"复利 最新"}' } },
          ],
        },
      },
    ],
  }

  function agentFetch() {
    const queue = [
      () => jsonResponse(TOOL_CALL),
      () => jsonResponse({ organic: [{ title: '结果一', link: 'https://a.com', snippet: '摘要' }] }),
      () => jsonResponse({ choices: [{ finish_reason: 'stop', message: { content: '带引用的回答' } }] }),
    ]
    return vi.fn(async () => Promise.resolve(queue.shift()()))
  }

  function jsonResponse(payload, status = 200) {
    return new Response(JSON.stringify(payload), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  it('先推工具状态事件，再推最终回答内容，密钥不随流泄漏', async () => {
    const fetchImpl = agentFetch()
    running = await serve(
      baseConfig({ serperKey: 'serper-real', jinaKey: 'jina-real' }),
      fetchImpl,
    )
    const response = await fetch(`${running.base}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: '最近复利有什么说法' }] }),
    })
    const text = await response.text()

    expect(response.status).toBe(200)
    expect(text).toContain('正在搜索：复利 最新')
    expect(text).toContain('"content":"带引用的回答"')
    expect(text).toContain('[DONE]')
    expect(text).not.toContain('serper-real')
    expect(text).not.toContain('jina-real')
    expect(text).not.toContain(KEY)
  })

  it('agent 内部出错时不中断连接，改为直接作答兜底', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: 'boom' }, 500))
    running = await serve(baseConfig({ serperKey: 's', jinaKey: 'j' }), fetchImpl)
    const response = await fetch(`${running.base}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
    })
    const text = await response.text()

    expect(response.status).toBe(200)
    expect(text).toContain('服务暂时异常')
    expect(text).toContain('[DONE]')
  })

  /** 把若干段 SSE 文本包成流式响应，模拟会分块下发的上游。 */
  function sseUpstream(chunks) {
    return new Response(sseStream(chunks), {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    })
  }

  function contentChunk(text) {
    return `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`
  }

  /** 工具轮次 + 分块最终回答的上游桩。 */
  function agentFetchStream() {
    let step = 0
    return vi.fn(async (url) => {
      const urlStr = String(url)
      if (urlStr.includes('chat/completions')) {
        step += 1
        if (step === 1) {
          return sseUpstream([
            `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_9', type: 'function', function: { name: 'search', arguments: '{"query":"复利 最新"}' } }] } }] })}\n\n`,
            'data: [DONE]\n\n',
          ])
        }
        return sseUpstream([
          contentChunk('带引用的'),
          contentChunk('回答'),
          contentChunk('。'),
          'data: [DONE]\n\n',
        ])
      }
      if (urlStr.includes('serper.dev')) {
        return jsonResponse({
          organic: [{ title: '结果一', link: 'https://a.com', snippet: '摘要' }],
        })
      }
      throw new Error(`未知请求 ${urlStr}`)
    })
  }

  it('最终回答按增量分段推给前端，而不是攒成一条整文', async () => {
    running = await serve(baseConfig({ serperKey: 's', jinaKey: 'j' }), agentFetchStream())
    const response = await fetch(`${running.base}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: '复利' }] }),
    })
    const text = await response.text()

    // 关键：三段内容各自成为独立的 SSE 事件，前端才能边收边渲染
    const deltaEvents = text
      .split('\n\n')
      .filter((block) => block.includes('"delta"'))
      .map((block) => block.replace(/^data: /, ''))
    expect(deltaEvents).toHaveLength(3)
    expect(deltaEvents.map((event) => JSON.parse(event).choices[0].delta.content)).toEqual([
      '带引用的',
      '回答',
      '。',
    ])
  })

  function streamKeyOf(payload) {
    return computeStreamKey({
      messages: payload.messages,
      model: 'default-model',
    })
  }

  it('客户端中途断开时，服务端仍把回答跑完并暂存：回来后按 streamKey 能拉回完整文本', async () => {
    const chunkA = contentChunk('前半段')
    const chunkB = contentChunk('后半段')
    const payload = { messages: [{ role: 'user', content: '讲一段分两段的故事' }] }

    const fetchImpl = vi.fn(async () => sseUpstream([chunkA, chunkB, 'data: [DONE]\n\n']))
    running = await serve(baseConfig(), fetchImpl)

    const abort = new AbortController()
    // 收满第一段就断：要证实的是服务端不会因为客户端断开而中止
    const firstResponse = await fetch(`${running.base}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: abort.signal,
    })
    abort.abort()
    // 让服务端把这次生成跑完
    await new Promise((resolve) => setTimeout(resolve, 300))

    const streamKey = streamKeyOf(payload)
    const resumed = await fetch(`${running.base}/api/chat/resume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ streamKey }),
    })
    const body = await resumed.json()

    expect(resumed.status).toBe(200)
    expect(body.content).toBe('前半段后半段')
  })

  it('resume 拿到的 key 必须是已存在的残迹号；不存在的 key 返回 404', async () => {
    running = await serve(baseConfig(), vi.fn())
    const resumed = await fetch(`${running.base}/api/chat/resume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ streamKey: 'missing-key' }),
    })
    expect(resumed.status).toBe(404)
  })

  it('断开后完成的回答经过 resume 拉取后，检查记录中的状态仍与完成一致', async () => {
    const payload = { messages: [{ role: 'user', content: '两个字' }] }
    const fetchImpl = vi.fn(async () => sseUpstream([contentChunk('短'), contentChunk('答'), 'data: [DONE]\n\n']))
    running = await serve(baseConfig(), fetchImpl)

    await fetch(`${running.base}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    await new Promise((resolve) => setTimeout(resolve, 200))

    const streamKey = streamKeyOf(payload)
    const resumed = await fetch(`${running.base}/api/chat/resume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ streamKey }),
    })
    const body = await resumed.json()
    expect(body.status).toBe('done')
  })
})
