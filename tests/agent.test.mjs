import { createServer } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runAgentTurn, TOOL_DEFS } from '../server/agent.mjs'
import { executeTool } from '../server/tools.mjs'

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const SERPER_BODY = {
  organic: [
    { title: '复利 - 维基百科', link: 'https://zh.wikipedia.org/wiki/复利', snippet: '复利是一种计算利息的方法' },
    { title: '单利与复利', link: 'https://example.com/a', snippet: '两者区别在计息基数' },
    { title: '第三条', link: 'https://example.com/b', snippet: '更多说明' },
    { title: '第四条', link: 'https://example.com/c', snippet: '略' },
    { title: '第五条', link: 'https://example.com/d', snippet: '略' },
    { title: '第六条', link: 'https://example.com/e', snippet: '略' },
  ],
}

describe('executeTool', () => {
  it('search：以 X-API-KEY 调用 serper 并取前 5 条结果', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(SERPER_BODY))
    const config = {
      serperKey: 'serper-k',
      serperBase: 'https://google.serper.dev',
      jinaKey: '',
      jinaBase: 'https://r.jina.ai',
    }
    const out = await executeTool(config, 'search', { query: '复利怎么算' }, fetchImpl)
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe('https://google.serper.dev/search')
    expect(init.headers['X-API-KEY']).toBe('serper-k')
    expect(JSON.parse(init.body)).toEqual({ q: '复利怎么算', gl: 'cn', hl: 'zh-cn' })
    expect(out).toContain('复利 - 维基百科')
    expect(out).toContain('https://zh.wikipedia.org/wiki/复利')
    // 预算放宽：第 6 条也在，只到第 8 条截断
    expect(out).toContain('第六条')
    expect(out).not.toContain('第九条')
  })

  it('read_url：以 Bearer 调用 jina reader 并截断超长正文', async () => {
    const longText = '正文'.repeat(4000)
    const fetchImpl = vi.fn(async () => new Response(longText, { status: 200 }))
    const config = {
      serperKey: '',
      serperBase: 'https://google.serper.dev',
      jinaKey: 'jina-k',
      jinaBase: 'https://r.jina.ai',
    }
    const out = await executeTool(config, 'read_url', { url: 'https://example.com/post' }, fetchImpl)
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe('https://r.jina.ai/https://example.com/post')
    expect(init.headers.Authorization).toBe('Bearer jina-k')
    expect(out.length).toBeLessThanOrEqual(8200)
  })

  it('read_url：url 不是 http(s) 时直接拒绝，不发请求', async () => {
    const fetchImpl = vi.fn()
    const config = { serperKey: '', serperBase: '', jinaKey: 'k', jinaBase: 'https://r.jina.ai' }
    await expect(executeTool(config, 'read_url', { url: 'file:///etc/passwd' }, fetchImpl)).rejects.toThrow(/http/)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('缺少对应密钥时返回不可用说明而不是抛错', async () => {
    const config = { serperKey: '', serperBase: 'https://google.serper.dev', jinaKey: '', jinaBase: '' }
    const out = await executeTool(config, 'search', { query: 'x' }, vi.fn())
    expect(out).toContain('未配置')
  })

  it('上游报错时把状态码塞进结果，模型可读后自行解释', async () => {
    const fetchImpl = vi.fn(async () => new Response('denied', { status: 403 }))
    const config = { serperKey: 'k', serperBase: 'https://google.serper.dev', jinaKey: '', jinaBase: '' }
    const out = await executeTool(config, 'search', { query: 'x' }, fetchImpl)
    expect(out).toContain('403')
  })
})

describe('TOOL_DEFS', () => {
  it('声明 search 与 read_url 两个工具', () => {
    const names = TOOL_DEFS.map((t) => t.function?.name)
    expect(names).toEqual(['search', 'read_url'])
  })

  it('工具的必填参数正确', () => {
    const search = TOOL_DEFS.find((t) => t.function?.name === 'search')
    const reader = TOOL_DEFS.find((t) => t.function?.name === 'read_url')
    expect(search.function.parameters.required).toEqual(['query'])
    expect(reader.function.parameters.required).toEqual(['url'])
  })
})

describe('runAgentTurn', () => {
  const agentConfig = {
    baseUrl: 'https://upstream.example/v1',
    apiKey: 'model-key',
    model: 'm',
    serperKey: 'serper-k',
    serperBase: 'https://google.serper.dev',
    jinaKey: 'jina-k',
    jinaBase: 'https://r.jina.ai',
  }

  const toolCallPayload = {
    choices: [
      {
        finish_reason: 'tool_calls',
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            { id: 'call_1', type: 'function', function: { name: 'search', arguments: '{"query":"复利定义"}' } },
          ],
        },
      },
    ],
  }

  function makeFetch(steps) {
    const queue = [...steps]
    return vi.fn(async (url, init) => {
      const urlStr = String(url)
      if (urlStr.includes('chat/completions')) return Promise.resolve(queue.shift()())
      if (urlStr.includes('serper.dev')) return jsonResponse(SERPER_BODY)
      if (urlStr.includes('r.jina.ai')) return new Response('页面正文', { status: 200 })
      throw new Error(`未知请求 ${urlStr}`)
    })
  }

  it('模型要调工具时执行并回填，最终返回回答与工具轨迹', async () => {
    const finalPayload = { choices: [{ finish_reason: 'stop', message: { content: '复利是利滚利' } }] }
    const fetchImpl = makeFetch([() => jsonResponse(toolCallPayload), () => jsonResponse(finalPayload)])
    const result = await runAgentTurn(agentConfig, [{ role: 'user', content: '复利是什么' }], fetchImpl, () => {})
    expect(result.content).toBe('复利是利滚利')

    const llmCalls = fetchImpl.mock.calls
      .filter(([u]) => String(u).includes('chat/completions'))
      .map(([, init]) => JSON.parse(init.body))
    const second = llmCalls[1]
    const toolMsg = second.messages.find((m) => m.role === 'tool' && m.tool_call_id === 'call_1')
    expect(toolMsg).toBeTruthy()
    expect(toolMsg.content).toContain('复利 - 维基百科')

    expect(llmCalls[0].tools).toEqual(TOOL_DEFS)
  })

  it('模型首轮直接作答则不加工具往返', async () => {
    const finalPayload = { choices: [{ finish_reason: 'stop', message: { content: '直接回答' } }] }
    const fetchImpl = makeFetch([() => jsonResponse(finalPayload)])
    const result = await runAgentTurn(agentConfig, [{ role: 'user', content: 'hi' }], fetchImpl, () => {})
    expect(result.content).toBe('直接回答')
    const calls = fetchImpl.mock.calls.filter(([u]) => String(u).includes('chat/completions'))
    expect(calls).toHaveLength(1)
  })

  it('每次工具调用都会回调状态（搜索词/目标地址）', async () => {
    const finalPayload = { choices: [{ finish_reason: 'stop', message: { content: 'ans' } }] }
    const fetchImpl = makeFetch([() => jsonResponse(toolCallPayload), () => jsonResponse(finalPayload)])
    const steps = []
    await runAgentTurn(agentConfig, [{ role: 'user', content: 'x' }], fetchImpl, (step) => steps.push(step))
    expect(steps).toEqual([{ tool: 'search', detail: '复利定义' }])
  })

  it('连续多轮 tool_calls 能迭代到最终回答，且预算放宽到不漏', async () => {
    const calls = Array.from({ length: 8 }, () => () => jsonResponse(toolCallPayload))
    calls.push(() => jsonResponse({ choices: [{ finish_reason: 'stop', message: { content: '封顶' } }] }))
    const fetchImpl = makeFetch(calls)
    const result = await runAgentTurn(agentConfig, [{ role: 'user', content: 'x' }], fetchImpl, () => {})
    expect(result.content).toBe('封顶')
    const llmCalls = fetchImpl.mock.calls.filter(([u]) => String(u).includes('chat/completions'))
    expect(llmCalls.length).toBeLessThanOrEqual(13)
  })

  it('上游返回非 2xx 时抛出状态码错误', async () => {
    const fetchImpl = makeFetch([() => jsonResponse({ error: 'boom' }, 500)])
    await expect(runAgentTurn(agentConfig, [{ role: 'user', content: 'x' }], fetchImpl, () => {})).rejects.toThrow(/500/)
  })

  it('读过网页后，最终作答前会把已读来源清单注入上下文', async () => {
    const readCall = {
      choices: [
        {
          finish_reason: 'tool_calls',
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              { id: 'r1', type: 'function', function: { name: 'read_url', arguments: '{"url":"https://example.com/post"}' } },
            ],
          },
        },
      ],
    }
    const finalPayload = { choices: [{ finish_reason: 'stop', message: { content: '基于来源的回答' } }] }
    // 读 → 注入来源清单后重问 → 最终回答；mock 队列需提供三轮响应
    const fetchImpl = makeFetch([
      () => jsonResponse(readCall),
      () => jsonResponse(finalPayload),
      () => jsonResponse(finalPayload),
    ])
    await runAgentTurn(agentConfig, [{ role: 'user', content: '查一下' }], fetchImpl, () => {})

    const llmCalls = fetchImpl.mock.calls
      .filter(([u]) => String(u).includes('chat/completions'))
      .map(([, init]) => JSON.parse(init.body))
    // 最后一轮调 LLM 的 messages 里应包含本次已读来源的清单，告知模型引用这些链接
    const last = llmCalls[llmCalls.length - 1]
    const hasSourceHint = last.messages.some(
      (m) => m.role === 'system' && String(m.content).includes('https://example.com/post'),
    )
    expect(hasSourceHint).toBe(true)
  })

  it('全程只搜索未读网页时不注入来源清单', async () => {
    const finalPayload = { choices: [{ finish_reason: 'stop', message: { content: '只搜摘要' } }] }
    const fetchImpl = makeFetch([() => jsonResponse(toolCallPayload), () => jsonResponse(finalPayload)])
    await runAgentTurn(agentConfig, [{ role: 'user', content: 'x' }], fetchImpl, () => {})
    const llmCalls = fetchImpl.mock.calls
      .filter(([u]) => String(u).includes('chat/completions'))
      .map(([, init]) => JSON.parse(init.body))
    const last = llmCalls[llmCalls.length - 1]
    const hasSourceHint = last.messages.some(
      (m) => m.role === 'system' && String(m.content).includes('https://zh.wikipedia.org/wiki/复利'),
    )
    // 摘要来自搜索返回，不是 read_url 读取，不应被当作"已读来源"注入
    expect(hasSourceHint).toBe(false)
  })

  /** 同一轮里并行发多个 read_url 调用的响应。 */
  function parallelReadCalls(urls) {
    return {
      choices: [
        {
          finish_reason: 'tool_calls',
          message: {
            role: 'assistant',
            content: null,
            tool_calls: urls.map((url, index) => ({
              id: `r${index}`,
              type: 'function',
              function: { name: 'read_url', arguments: JSON.stringify({ url }) },
            })),
          },
        },
      ],
    }
  }

  it('同一轮的多个工具调用并发执行，而不是逐个排队', async () => {
    // 每个 read_url 阻塞 120ms；串行会累加到 360ms 以上
    let inFlight = 0
    let peak = 0
    const urls = ['https://a.com/1', 'https://a.com/2', 'https://a.com/3']
    const finalPayload = { choices: [{ finish_reason: 'stop', message: { content: '并发完成' } }] }
    let llmStep = 0

    const fetchImpl = vi.fn(async (url) => {
      const urlStr = String(url)
      if (urlStr.includes('chat/completions')) {
        llmStep += 1
        return jsonResponse(llmStep === 1 ? parallelReadCalls(urls) : finalPayload)
      }
      if (urlStr.includes('r.jina.ai')) {
        inFlight += 1
        peak = Math.max(peak, inFlight)
        await new Promise((resolve) => setTimeout(resolve, 120))
        inFlight -= 1
        return new Response(`正文 ${urlStr}`, { status: 200 })
      }
      throw new Error(`未知请求 ${urlStr}`)
    })

    const started = Date.now()
    await runAgentTurn(agentConfig, [{ role: 'user', content: '查几个页面' }], fetchImpl, () => {})
    const elapsed = Date.now() - started

    expect(peak).toBeGreaterThanOrEqual(2)
    expect(elapsed).toBeLessThan(360)
  })

  it('并发执行的多个工具调用，回填仍按 tool_call_id 一一对应', async () => {
    const urls = ['https://b.com/1', 'https://b.com/2']
    const finalPayload = { choices: [{ finish_reason: 'stop', message: { content: 'ok' } }] }
    let llmStep = 0
    const fetchImpl = vi.fn(async (url) => {
      const urlStr = String(url)
      if (urlStr.includes('chat/completions')) {
        llmStep += 1
        return jsonResponse(llmStep === 1 ? parallelReadCalls(urls) : finalPayload)
      }
      // 第二个更慢：结果必须回到自己的 tool_call_id，不能按完成先后错位
      const delay = urlStr.includes('/2') ? 100 : 10
      await new Promise((resolve) => setTimeout(resolve, delay))
      return new Response(`正文 ${urlStr}`, { status: 200 })
    })

    await runAgentTurn(agentConfig, [{ role: 'user', content: 'x' }], fetchImpl, () => {})

    const llmCalls = fetchImpl.mock.calls
      .filter(([u]) => String(u).includes('chat/completions'))
      .map(([, init]) => JSON.parse(init.body))
    const toolMsgs = llmCalls[1].messages.filter((m) => m.role === 'tool')

    expect(toolMsgs).toHaveLength(2)
    const byId = Object.fromEntries(toolMsgs.map((m) => [m.tool_call_id, m.content]))
    expect(byId.r0).toContain('/1')
    expect(byId.r1).toContain('/2')
  })

  it('并发时单个工具失败不影响其它工具的回填', async () => {
    const urls = ['https://c.com/ok', 'file:///etc/passwd']
    const finalPayload = { choices: [{ finish_reason: 'stop', message: { content: 'ok' } }] }
    let llmStep = 0
    const fetchImpl = vi.fn(async (url) => {
      const urlStr = String(url)
      if (urlStr.includes('chat/completions')) {
        llmStep += 1
        return jsonResponse(llmStep === 1 ? parallelReadCalls(urls) : finalPayload)
      }
      return new Response('正文', { status: 200 })
    })

    await runAgentTurn(agentConfig, [{ role: 'user', content: 'x' }], fetchImpl, () => {})

    const llmCalls = fetchImpl.mock.calls
      .filter(([u]) => String(u).includes('chat/completions'))
      .map(([, init]) => JSON.parse(init.body))
    const toolMsgs = llmCalls[1].messages.filter((m) => m.role === 'tool')
    const byId = Object.fromEntries(toolMsgs.map((m) => [m.tool_call_id, m.content]))

    expect(byId.r0).toContain('正文')
    expect(byId.r1).toMatch(/失败|http/)
  })
})
