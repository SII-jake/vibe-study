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
  const bundleConfig = {
    baseUrl: 'https://llm.example/v1',
    apiKey: 'model-key',
    model: 'm',
    serperKey: 'serper-k',
    serperBase: 'https://google.serper.dev',
    jinaKey: 'jina-k',
    jinaBase: 'https://r.jina.ai',
  }

  const ORGANIC_A = { organic: [{ title: '页面甲', link: 'https://a.com/1', snippet: '摘要甲' }] }
  const ORGANIC_B = { organic: [{ title: '页面乙', link: 'https://b.com/2', snippet: '摘要乙' }] }

  it('search 打包工具：多个关键词各自搜索，并抓回各自顶部页面正文', async () => {
    const fetchImpl = vi.fn(async (url, init) => {
      const urlStr = String(url)
      if (urlStr === 'https://google.serper.dev/search') {
        const q = JSON.parse(init.body).q
        return jsonResponse(q === '词一' ? ORGANIC_A : ORGANIC_B)
      }
      if (urlStr.startsWith('https://r.jina.ai/')) return new Response('正文', { status: 200 })
      throw new Error(`未知请求 ${urlStr}`)
    })
    const out = await executeTool(bundleConfig, 'search', { queries: ['词一', '词二'] }, fetchImpl)

    // 两个 serper 调用、两个 jina 调用，一次发起
    expect(fetchImpl.mock.calls.filter(([u]) => String(u).includes('serper.dev'))).toHaveLength(2)
    const jinaCalls = fetchImpl.mock.calls.filter(([u]) => String(u).startsWith('https://r.jina.ai/'))
    expect(jinaCalls).toHaveLength(2)
    expect(jinaCalls.map(([u]) => String(u))).toEqual([
      'https://r.jina.ai/https://a.com/1',
      'https://r.jina.ai/https://b.com/2',
    ])
    expect(out).toContain('页面甲')
    expect(out).toContain('https://a.com/1')
    expect(out).toContain('正文')
    expect(out).toContain('页面乙')
  })

  it('多关键词命中的页面去重，同 URL 只抓一次正文', async () => {
    // 两个关键词都命中同一页面
    const fetchImpl = vi.fn(async (url) => {
      const urlStr = String(url)
      if (urlStr === 'https://google.serper.dev/search') return jsonResponse(ORGANIC_A)
      if (urlStr.startsWith('https://r.jina.ai/')) return new Response('正文', { status: 200 })
      throw new Error(`未知请求 ${urlStr}`)
    })
    await executeTool(bundleConfig, 'search', { queries: ['词一', '词一'] }, fetchImpl)
    expect(fetchImpl.mock.calls.filter(([u]) => String(u).includes('serper.dev'))).toHaveLength(1)
    expect(fetchImpl.mock.calls.filter(([u]) => String(u).startsWith('https://r.jina.ai/'))).toHaveLength(1)
  })

  it('单页抓取失败不影响其它页面，失败处标注', async () => {
    const fetchImpl = vi.fn(async (url) => {
      const urlStr = String(url)
      if (urlStr === 'https://google.serper.dev/search') return jsonResponse(ORGANIC_A)
      if (urlStr.startsWith('https://r.jina.ai/')) return new Response('too many', { status: 429 })
      throw new Error(`未知请求 ${urlStr}`)
    })
    const out = await executeTool(bundleConfig, 'search', { queries: ['词一'] }, fetchImpl)
    expect(out).toMatch(/页面甲/)
    expect(out).toMatch(/429|失败/)
  })

  it('正文截到每页上限，避免超长页面把上下文撑爆', async () => {
    const fetchImpl = vi.fn(async (url) => {
      const urlStr = String(url)
      if (urlStr === 'https://google.serper.dev/search') return jsonResponse(ORGANIC_A)
      if (urlStr.startsWith('https://r.jina.ai/')) return new Response('正'.repeat(5000), { status: 200 })
      throw new Error(`未知请求 ${urlStr}`)
    })
    const out = await executeTool(bundleConfig, 'search', { queries: ['词一'] }, fetchImpl)
    expect(out.length).toBeLessThan(5000)
  })

  it('query 单字符串与 queries 数组都接受', async () => {
    const fetchImpl = vi.fn(async (url) => {
      if (String(url).includes('serper.dev')) return jsonResponse(ORGANIC_A)
      if (String(url).startsWith('https://r.jina.ai/')) return new Response('正文', { status: 200 })
      throw new Error(String(url))
    })
    const out = await executeTool(bundleConfig, 'search', { query: '单个词' }, fetchImpl)
    expect(out).toContain('页面甲')
  })

  it('keywords 为空时返回说明，不发任何请求', async () => {
    const fetchImpl = vi.fn()
    const out = await executeTool(bundleConfig, 'search', { queries: [] }, fetchImpl)
    expect(out).toMatch(/空|未提供|关键词/)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('缺少密钥时返回不可用说明而不是抛错', async () => {
    const noKey = { ...bundleConfig, serperKey: '', jinaKey: '' }
    const out = await executeTool(noKey, 'search', { queries: ['x'] }, vi.fn())
    expect(out).toContain('未配置')
  })
})

describe('TOOL_DEFS', () => {
  it('只声明一个打包的 search 工具（检索+抓正文一体）', () => {
    const names = TOOL_DEFS.map((t) => t.function?.name)
    expect(names).toEqual(['search'])
  })

  it('search 接受关键词数组，一次发起多轮检索与抓取', () => {
    const search = TOOL_DEFS.find((t) => t.function?.name === 'search')
    expect(search.function.parameters.required).toEqual(['queries'])
    const queries = search.function.parameters.properties.queries
    expect(queries.type).toBe('array')
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
            { id: 'call_1', type: 'function', function: { name: 'search', arguments: '{"queries":["复利定义"]}' } },
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

  /** 同一轮里并行发多个打包 search 调用的响应。 */
  function parallelSearchCalls(queriesList) {
    return {
      choices: [
        {
          finish_reason: 'tool_calls',
          message: {
            role: 'assistant',
            content: null,
            tool_calls: queriesList.map((queries, index) => ({
              id: `r${index}`,
              type: 'function',
              function: { name: 'search', arguments: JSON.stringify({ queries }) },
            })),
          },
        },
      ],
    }
  }

  it('同一轮的多个工具调用并发执行，而不是逐个排队', async () => {
    // 每个 search 的 serper 请求阻塞 120ms；串行会累加到 360ms 以上
    let inFlight = 0
    let peak = 0
    const queriesList = [['甲'], ['乙'], ['丙']]
    const finalPayload = { choices: [{ finish_reason: 'stop', message: { content: '并发完成' } }] }
    let llmStep = 0

    const fetchImpl = vi.fn(async (url) => {
      const urlStr = String(url)
      if (urlStr.includes('chat/completions')) {
        llmStep += 1
        return jsonResponse(llmStep === 1 ? parallelSearchCalls(queriesList) : finalPayload)
      }
      if (urlStr.includes('serper.dev')) {
        inFlight += 1
        peak = Math.max(peak, inFlight)
        await new Promise((resolve) => setTimeout(resolve, 120))
        inFlight -= 1
        return jsonResponse({ organic: [{ title: 't', link: 'https://p.com/x', snippet: 's' }] })
      }
      if (urlStr.includes('r.jina.ai')) {
        return new Response(`正文 ${urlStr}`, { status: 200 })
      }
      throw new Error(`未知请求 ${urlStr}`)
    })

    const started = Date.now()
    await runAgentTurn(agentConfig, [{ role: 'user', content: '查几个词' }], fetchImpl, () => {})
    const elapsed = Date.now() - started

    expect(peak).toBeGreaterThanOrEqual(2)
    expect(elapsed).toBeLessThan(360)
  })

  it('并发执行的多个工具调用，回填仍按 tool_call_id 一一对应', async () => {
    // 用第二个查询词更慢的 serper 响应：结果必须回到自己的 tool_call_id
    const finalPayload = { choices: [{ finish_reason: 'stop', message: { content: 'ok' } }] }
    let llmStep = 0
    const fetchImpl = vi.fn(async (url, init) => {
      const urlStr = String(url)
      if (urlStr.includes('chat/completions')) {
        llmStep += 1
        return jsonResponse(llmStep === 1 ? parallelSearchCalls([['词一'], ['词二']]) : finalPayload)
      }
      if (urlStr.includes('serper.dev')) {
        const q = JSON.parse(init.body).q
        await new Promise((resolve) => setTimeout(resolve, q === '词二' ? 100 : 10))
        return jsonResponse({ organic: [{ title: `t-${q}`, link: `https://p.com/${q}`, snippet: `s-${q}` }] })
      }
      return new Response('正文', { status: 200 })
    })

    await runAgentTurn(agentConfig, [{ role: 'user', content: 'x' }], fetchImpl, () => {})

    const llmCalls = fetchImpl.mock.calls
      .filter(([u]) => String(u).includes('chat/completions'))
      .map(([, init]) => JSON.parse(init.body))
    const toolMsgs = llmCalls[1].messages.filter((m) => m.role === 'tool')

    expect(toolMsgs).toHaveLength(2)
    const byId = Object.fromEntries(toolMsgs.map((m) => [m.tool_call_id, m.content]))
    expect(byId.r0).toContain('词一')
    expect(byId.r1).toContain('词二')
  })

  it('并发时单个工具失败不影响其它工具的回填', async () => {
    // 第二个 search 调 serper 返回 500：第一个的结果不受影响，错误以文本回填
    const finalPayload = { choices: [{ finish_reason: 'stop', message: { content: 'ok' } }] }
    let llmStep = 0
    const fetchImpl = vi.fn(async (url, init) => {
      const urlStr = String(url)
      if (urlStr.includes('chat/completions')) {
        llmStep += 1
        return jsonResponse(llmStep === 1 ? parallelSearchCalls([['正常词'], ['失败词']]) : finalPayload)
      }
      if (urlStr.includes('serper.dev')) {
        const q = JSON.parse(init.body).q
        if (q === '失败词') return new Response('denied', { status: 500 })
        return jsonResponse({ organic: [{ title: '页面甲', link: 'https://a.com/1', snippet: '摘要' }] })
      }
      return new Response('正文', { status: 200 })
    })

    await runAgentTurn(agentConfig, [{ role: 'user', content: 'x' }], fetchImpl, () => {})

    const llmCalls = fetchImpl.mock.calls
      .filter(([u]) => String(u).includes('chat/completions'))
      .map(([, init]) => JSON.parse(init.body))
    const toolMsgs = llmCalls[1].messages.filter((m) => m.role === 'tool')
    const byId = Object.fromEntries(toolMsgs.map((m) => [m.tool_call_id, m.content]))

    expect(byId.r0).toContain('页面甲')
    expect(byId.r1).toMatch(/500|失败/)
  })

  /** 把若干段 SSE 文本包成一个流式响应，模拟 OpenAI 兼容上游。 */
  function sseResponse(chunks) {
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
        controller.close()
      },
    })
    return new Response(stream, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    })
  }

  function contentChunk(text) {
    return `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`
  }

  it('最终回答按增量回调，而不是等全文到齐再一次性返回', async () => {
    const fetchImpl = vi.fn(async () => {
      return sseResponse([contentChunk('复利'), contentChunk('是'), contentChunk('利滚利'), 'data: [DONE]\n\n'])
    })

    const deltas = []
    const result = await runAgentTurn(
      agentConfig,
      [{ role: 'user', content: '复利是什么' }],
      fetchImpl,
      () => {},
      (delta) => deltas.push(delta),
    )

    // 关键：必须是分多次回调，前端才能边收边渲染
    expect(deltas).toEqual(['复利', '是', '利滚利'])
    expect(result.content).toBe('复利是利滚利')
  })

  it('流式请求里带上 stream: true，否则上游不会分块返回', async () => {
    const fetchImpl = vi.fn(async () => sseResponse([contentChunk('x'), 'data: [DONE]\n\n']))
    await runAgentTurn(agentConfig, [{ role: 'user', content: 'q' }], fetchImpl, () => {}, () => {})
    const [, init] = fetchImpl.mock.calls[0]
    expect(JSON.parse(init.body).stream).toBe(true)
  })

  it('工具轮次的增量流仍能解析出 tool_calls 并执行', async () => {
    // 工具调用在流式协议里也是分片下发的（id/name/arguments 分开）
    const toolStream = sseResponse([
      `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'search', arguments: '{"queries":' } }] } }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '["复利定义"]}' } }] } }] })}\n\n`,
      'data: [DONE]\n\n',
    ])
    const finalStream = sseResponse([contentChunk('答完了'), 'data: [DONE]\n\n'])

    let step = 0
    const fetchImpl = vi.fn(async (url) => {
      const urlStr = String(url)
      if (urlStr.includes('chat/completions')) {
        step += 1
        return step === 1 ? toolStream : finalStream
      }
      if (urlStr.includes('serper.dev')) return jsonResponse(SERPER_BODY)
      throw new Error(`未知请求 ${urlStr}`)
    })

    const steps = []
    const result = await runAgentTurn(
      agentConfig,
      [{ role: 'user', content: 'x' }],
      fetchImpl,
      (s) => steps.push(s),
      () => {},
    )

    // 分片拼回的参数必须完整，否则搜索词会变成残缺的 JSON
    expect(steps).toEqual([{ tool: 'search', detail: '复利定义' }])
    expect(result.content).toBe('答完了')
  })

  it('工具轮次里模型先说的话不算最终答案，需通知前端清掉已显示的增量', async () => {
    // 模型可能先说一句"我查一下"，随后才调工具；这段文字不能留在答案里
    const talkThenTool = sseResponse([
      contentChunk('我先查一下。'),
      `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_9', type: 'function', function: { name: 'search', arguments: '{"queries":["x"]}' } }] } }] })}\n\n`,
      'data: [DONE]\n\n',
    ])
    const finalStream = sseResponse([contentChunk('真正的答案'), 'data: [DONE]\n\n'])

    let step = 0
    const fetchImpl = vi.fn(async (url) => {
      const urlStr = String(url)
      if (urlStr.includes('chat/completions')) {
        step += 1
        return step === 1 ? talkThenTool : finalStream
      }
      if (urlStr.includes('serper.dev')) return jsonResponse(SERPER_BODY)
      throw new Error(`未知请求 ${urlStr}`)
    })

    let resets = 0
    const result = await runAgentTurn(
      agentConfig,
      [{ role: 'user', content: 'x' }],
      fetchImpl,
      () => {},
      () => {},
      () => {
        resets += 1
      },
    )

    expect(resets).toBeGreaterThanOrEqual(1)
    expect(result.content).toBe('真正的答案')
  })

  /**
   * 上游发完 [DONE] 常常不会立刻断开连接。
   * 若读取提前结束却不释放 body，连接带着未读完数据回到池子，
   * 下一轮请求（工具循环里很常见）复用这条坏连接就会 fetch failed。
   */
  function trackingSseResponse(chunks) {
    const encoder = new TextEncoder()
    let cancelled = false
    const stream = new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
        // 刻意不 close：模拟上游保持连接但不再发数据
      },
      cancel() {
        cancelled = true
      },
    })
    return {
      response: new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }),
      wasCancelled: () => cancelled,
    }
  }

  it('收到 [DONE] 提前结束时释放响应体，避免连接带着残数据回到池子', async () => {
    const tracked = trackingSseResponse([contentChunk('答案'), 'data: [DONE]\n\n'])
    const fetchImpl = vi.fn(async () => tracked.response)

    const result = await runAgentTurn(
      agentConfig,
      [{ role: 'user', content: 'q' }],
      fetchImpl,
      () => {},
      () => {},
    )

    expect(result.content).toBe('答案')
    // 关键：body 必须被 cancel，否则下一次 fetch 会在这条坏连接上失败
    expect(tracked.wasCancelled()).toBe(true)
  })

  /**
   * 上游会空闲回收 keep-alive 连接；连接池把新请求发到一条刚要关闭的
   * socket 上时，undici 抛 `TypeError: fetch failed` / `terminated`。
   * 工具循环里两轮之间隔着搜索与读网页，最容易撞上。
   * 这类错误对幂等的模型调用应该重试，而不是直接把「服务暂时异常」甩给用户。
   */
  it('上游连接抖动时重试，而不是立刻让整轮失败', async () => {
    let attempts = 0
    const fetchImpl = vi.fn(async () => {
      attempts += 1
      if (attempts === 1) throw new TypeError('fetch failed')
      return sseResponse([contentChunk('答案'), 'data: [DONE]\n\n'])
    })

    const result = await runAgentTurn(
      agentConfig,
      [{ role: 'user', content: 'q' }],
      fetchImpl,
      () => {},
      () => {},
    )

    expect(attempts).toBe(2)
    expect(result.content).toBe('答案')
  })

  it('重试不会把已经吐给前端的增量重复一遍', async () => {
    // 第一轮成功吐了内容后才失败的场景不存在（失败发生在请求阶段），
    // 这里确认重试路径下 onDelta 只收到最终那一次的内容
    let attempts = 0
    const fetchImpl = vi.fn(async () => {
      attempts += 1
      if (attempts === 1) throw new TypeError('terminated')
      return sseResponse([contentChunk('完整'), contentChunk('答案'), 'data: [DONE]\n\n'])
    })

    const deltas = []
    await runAgentTurn(
      agentConfig,
      [{ role: 'user', content: 'q' }],
      fetchImpl,
      () => {},
      (d) => deltas.push(d),
    )

    expect(deltas).toEqual(['完整', '答案'])
  })

  it('重试有上限，连续失败仍会抛错（不无限重试）', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed')
    })
    await expect(
      runAgentTurn(agentConfig, [{ role: 'user', content: 'q' }], fetchImpl, () => {}, () => {}),
    ).rejects.toThrow(/fetch failed/)
    // 有限次尝试，避免把上游故障放大成请求风暴
    expect(fetchImpl.mock.calls.length).toBeLessThanOrEqual(3)
  })

  it('上游请求挂起超过超时上限时中止并触发重试，不再让用户无限等待', async () => {
    let attempts = 0
    const fetchImpl = vi.fn(async () => {
      attempts += 1
      if (attempts === 1) return new Promise(() => {}) // 第一次永不返回（挂起）
      return sseResponse([contentChunk('答案'), 'data: [DONE]\n\n'])
    })

    const started = Date.now()
    const result = await runAgentTurn(
      { ...agentConfig, llmTimeoutMs: 80 },
      [{ role: 'user', content: 'q' }],
      fetchImpl,
      () => {},
      () => {},
    )

    expect(attempts).toBe(2)
    expect(result.content).toBe('答案')
    expect(Date.now() - started).toBeLessThan(1500)
  })

  it('每次挂起也算一次尝试，全部挂起时仍按上限抛错', async () => {
    const fetchImpl = vi.fn(async () => new Promise(() => {}))
    const started = Date.now()
    await expect(
      runAgentTurn(
        { ...agentConfig, llmTimeoutMs: 60 },
        [{ role: 'user', content: 'q' }],
        fetchImpl,
        () => {},
        () => {},
      ),
    ).rejects.toThrow()
    expect(fetchImpl.mock.calls.length).toBeLessThanOrEqual(3)
    expect(Date.now() - started).toBeLessThan(1500)
  })

  it('超时后重试的那次再吐增量，两次的文字不会重复出现', async () => {
    let attempts = 0
    const fetchImpl = vi.fn(async () => {
      attempts += 1
      if (attempts === 1) return new Promise(() => {})
      return sseResponse([contentChunk('完整'), contentChunk('答案'), 'data: [DONE]\n\n'])
    })
    const deltas = []
    await runAgentTurn(
      { ...agentConfig, llmTimeoutMs: 60 },
      [{ role: 'user', content: 'q' }],
      fetchImpl,
      () => {},
      (d) => deltas.push(d),
    )
    expect(deltas).toEqual(['完整', '答案'])
  })

  // 默认超时值属于配置层约定，不由 agent 决定在测试里；
  // config 解析的用例见 tests/server.test.mjs
})
