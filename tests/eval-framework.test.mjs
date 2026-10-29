import { describe, expect, it } from 'vitest'
import {
  aggregateRuns,
  classifyUrl,
  compareReports,
  createInstrumentedFetch,
  runQuestion,
} from '../eval/framework.mjs'

const config = {
  baseUrl: 'https://llm.example/v1',
  apiKey: 'k',
  model: 'm',
  serperKey: 's',
  serperBase: 'https://google.serper.dev',
  jinaKey: 'j',
  jinaBase: 'https://r.jina.ai',
}

function jsonResponse(payload = {}) {
  return new Response(JSON.stringify(payload), { status: 200 })
}

describe('classifyUrl', () => {
  it('按配置的上游地址区分 llm / serper / jina / other', () => {
    expect(classifyUrl(`${config.baseUrl}/chat/completions`, config)).toBe('llm')
    expect(classifyUrl('https://google.serper.dev/search', config)).toBe('serper')
    expect(classifyUrl('https://r.jina.ai/https://a.com', config)).toBe('jina')
    expect(classifyUrl('https://unrelated.example/x', config)).toBe('other')
  })

  it('配置换成自定义域名时仍按配置归类，不认死字符串', () => {
    const custom = { ...config, serperBase: 'https://proxy.internal/serper' }
    expect(classifyUrl('https://proxy.internal/serper/search', custom)).toBe('serper')
    expect(classifyUrl('https://google.serper.dev/search', custom)).toBe('other')
  })
})

describe('createInstrumentedFetch', () => {
  it('记录每次出网调用的类别与耗时', async () => {
    const inner = async () => {
      await new Promise((resolve) => setTimeout(resolve, 5))
      return jsonResponse()
    }
    const { fetchImpl, events } = createInstrumentedFetch(inner, config)
    await (await fetchImpl(`${config.baseUrl}/chat/completions`, {})).text()
    await fetchImpl('https://google.serper.dev/search', {})
    expect(events).toHaveLength(2)
    expect(events[0].kind).toBe('llm')
    expect(events[1].kind).toBe('serper')
    expect(events[0].ms).toBeGreaterThanOrEqual(0)
  })

  it('流式正文被完整消费时，ms 计到正文读完（而不只是响应头）', async () => {
    const encoder = new TextEncoder()
    const inner = async () =>
      new Response(
        new ReadableStream({
          async start(controller) {
            controller.enqueue(encoder.encode('chunk1'))
            await new Promise((resolve) => setTimeout(resolve, 60))
            controller.enqueue(encoder.encode('chunk2'))
            controller.close()
          },
        }),
        { status: 200 },
      )
    const { fetchImpl, events, finalize } = createInstrumentedFetch(inner, config)
    const response = await fetchImpl(`${config.baseUrl}/chat/completions`, {})
    expect(events[0].headerMs).toBeGreaterThanOrEqual(0)
    expect(events[0].ms).toBeNull()
    await response.text()
    finalize()
    expect(events[0].ms).toBeGreaterThanOrEqual(60)
    expect(events[0].ms).toBeGreaterThan(events[0].headerMs)
  })

  it('正文没被消费时 finalize 封顶，ms 不会停在 null', async () => {
    const inner = async () => new Response('unused body', { status: 200 })
    const { fetchImpl, events, finalize } = createInstrumentedFetch(inner, config)
    await fetchImpl('https://google.serper.dev/search', {})
    finalize()
    expect(events[0].ms).not.toBeNull()
    expect(events[0].headerMs).not.toBeNull()
  })

  it('调用在拿到响应前抛错（限流/超时）时，到抛错点的耗时也计入并标记失败', async () => {
    const inner = async () => {
      await new Promise((resolve) => setTimeout(resolve, 30))
      throw new Error('The operation was aborted due to timeout')
    }
    const { fetchImpl, events } = createInstrumentedFetch(inner, config)
    await expect(fetchImpl('https://r.jina.ai/https://a.com', {})).rejects.toThrow(/timeout/)
    // 失败前真实花掉的时间必须落进报告，丢成 0ms 会把「慢而失败」记成「快而失败」
    expect(events[0].kind).toBe('jina')
    expect(events[0].ms).toBeGreaterThanOrEqual(30)
    expect(events[0].headerMs).toBeGreaterThanOrEqual(30)
    expect(events[0].error).toBe(true)
  })
})

describe('runQuestion', () => {
  const question = { id: 'q1', expectedToolUse: 'search', text: '查一下' }

  it('汇总一跳 agent 的时延结构与工具计数', async () => {
    const fakeRunner = async (_config, _messages, fetchImpl, onStep, onDelta) => {
      await fetchImpl(`${config.baseUrl}/chat/completions`, {})
      await fetchImpl('https://google.serper.dev/search', {})
      await fetchImpl(`${config.baseUrl}/chat/completions`, {})
      onStep({ tool: 'search', detail: '复利' })
      onDelta('答案是')
      onDelta('利滚利 https://a.com')
      return { content: '答案是利滚利 https://a.com' }
    }
    const metrics = await runQuestion({ runner: fakeRunner, config, question, fetchImpl: async () => jsonResponse() })
    expect(metrics.llmCalls).toBe(2)
    expect(metrics.serperCalls).toBe(1)
    expect(metrics.jinaCalls).toBe(0)
    expect(metrics.totalMs).toBeGreaterThanOrEqual(metrics.llmMs)
    expect(metrics.firstDeltaMs).not.toBeNull()
    expect(metrics.firstDeltaMs).toBeLessThanOrEqual(metrics.totalMs)
    expect(metrics.contentLen).toBe('答案是利滚利 https://a.com'.length)
    expect(metrics.hasLinks).toBe(true)
    expect(metrics.error).toBeUndefined()
    // 逐跳明细进报告：慢在哪一跳可以直接从这个数组里看，不用靠猜
    expect(metrics.steps).toEqual([{ tool: 'search', detail: '复利' }])
    expect(metrics.events.map((e) => e.kind)).toEqual(['llm', 'serper', 'llm'])
  })

  it('全程没有增量输出时 firstDeltaMs 为 null', async () => {
    const silentRunner = async () => ({ content: '静默回答' })
    const metrics = await runQuestion({ runner: silentRunner, config, question, fetchImpl: async () => jsonResponse() })
    expect(metrics.firstDeltaMs).toBeNull()
  })

  it('runner 抛错不中断评测，错误记入该题结果', async () => {
    const badRunner = async () => {
      throw new Error('模型接口返回 500')
    }
    const metrics = await runQuestion({ runner: badRunner, config, question, fetchImpl: async () => jsonResponse() })
    expect(metrics.error).toContain('500')
    expect(metrics.contentLen).toBe(0)
    expect(metrics.totalMs).toBeGreaterThanOrEqual(0)
  })
})

describe('aggregateRuns', () => {
  const runs = [
    { totalMs: 100, firstDeltaMs: 40, llmCalls: 2, llmMs: 60, serperCalls: 1, serperMs: 20, jinaCalls: 1, jinaMs: 15, contentLen: 500, hasLinks: true },
    { totalMs: 200, firstDeltaMs: 80, llmCalls: 4, llmMs: 120, serperCalls: 2, serperMs: 40, jinaCalls: 2, jinaMs: 25, contentLen: 700, hasLinks: true },
    { totalMs: 300, firstDeltaMs: 120, llmCalls: 6, llmMs: 180, serperCalls: 3, serperMs: 60, jinaCalls: 3, jinaMs: 35, contentLen: 900, hasLinks: false },
  ]

  it('各项时延指标取中位数（奇数个运行）', () => {
    const report = aggregateRuns({ questions: [{ id: 'q1', expectedToolUse: 'search', runs }], meta: { tag: 't', runsPerQuestion: 3 } })
    const median = report.questions[0].median
    expect(median.totalMs).toBe(200)
    expect(median.firstDeltaMs).toBe(80)
    expect(median.llmCalls).toBe(4)
    expect(median.serperMs).toBe(40)
    expect(median.contentLen).toBe(700)
  })

  it('偶数个运行时取中间两值平均', () => {
    const report = aggregateRuns({
      questions: [{ id: 'q1', expectedToolUse: 'search', runs: runs.slice(0, 2) }],
      meta: { tag: 't', runsPerQuestion: 2 },
    })
    expect(report.questions[0].median.totalMs).toBe(150)
  })

  it('firstDeltaMs 为 null 的运行被排除后取中位，全 null 则为 null', () => {
    const mixedRuns = [{ ...runs[0], firstDeltaMs: null }, runs[1], runs[2]]
    const report = aggregateRuns({ questions: [{ id: 'q1', expectedToolUse: 'search', runs: mixedRuns }], meta: {} })
    expect(report.questions[0].median.firstDeltaMs).toBe(100)

    const allNull = runs.map((r) => ({ ...r, firstDeltaMs: null }))
    const report2 = aggregateRuns({ questions: [{ id: 'q1', expectedToolUse: 'search', runs: allNull }], meta: {} })
    expect(report2.questions[0].median.firstDeltaMs).toBeNull()
  })

  it('汇总所有题的中位数为 summary', () => {
    const report = aggregateRuns({
      questions: [
        { id: 'a', expectedToolUse: 'none', runs },
        { id: 'b', expectedToolUse: 'search', runs: runs.map((r) => ({ ...r, totalMs: r.totalMs + 100 })) },
      ],
      meta: {},
    })
    expect(report.summary.medianTotalMs).toBe(250)
    expect(report.summary.questionCount).toBe(2)
  })

  it('整题失败（error）时在题目结果里保留错误，汇总照常', () => {
    const errRuns = [runs[0], { ...runs[1], error: 'boom' }, runs[2]]
    const report = aggregateRuns({ questions: [{ id: 'q1', expectedToolUse: 'search', runs: errRuns }], meta: {} })
    expect(report.questions[0].errors).toEqual(['boom'])
    expect(report.questions[0].median.totalMs).toBe(200)
    // 原始 runs 原样保留：逐跳 events 与 steps 供事后排查
    expect(report.questions[0].rawRuns).toEqual(errRuns)
  })
})

describe('compareReports', () => {
  const mkReport = (tag, totals) =>
    aggregateRuns({
      questions: totals.map(([id, totalMs, expectedToolUse]) => ({
        id,
        expectedToolUse,
        runs: [
          { totalMs, firstDeltaMs: totalMs / 2, llmCalls: 2, llmMs: totalMs / 2, serperCalls: 1, serperMs: 10, jinaCalls: 0, jinaMs: 0, contentLen: 100, hasLinks: true },
        ],
      })),
      meta: { tag, runsPerQuestion: 1 },
    })

  it('按题对题输出时差与百分比', () => {
    const base = mkReport('base', [
      ['q1', 1000, 'none'],
      ['q2', 2000, 'search'],
    ])
    const cand = mkReport('cand', [
      ['q1', 500, 'none'],
      ['q2', 2200, 'search'],
    ])
    const comparison = compareReports(base, cand)
    const q1 = comparison.rows.find((row) => row.id === 'q1')
    expect(q1.baseMs).toBe(1000)
    expect(q1.candMs).toBe(500)
    expect(q1.deltaMs).toBe(-500)
    expect(q1.deltaPct).toBe(-50)
    const q2 = comparison.rows.find((row) => row.id === 'q2')
    expect(q2.deltaPct).toBe(10)
  })

  it('候选端缺题时该行只保留基准值', () => {
    const base = mkReport('base', [['q1', 1000, 'none']])
    const cand = mkReport('cand', [])
    const comparison = compareReports(base, cand)
    expect(comparison.rows[0].candMs).toBeNull()
    expect(comparison.rows[0].deltaMs).toBeNull()
  })

  it('汇总对比取两报告 summary 的差', () => {
    const base = mkReport('base', [['q1', 1000, 'none']])
    const cand = mkReport('cand', [['q1', 700, 'none']])
    const comparison = compareReports(base, cand)
    expect(comparison.summary.deltaMs).toBe(-300)
    expect(comparison.summary.deltaPct).toBe(-30)
  })
})
