import { runAgentTurn } from '../server/agent.mjs'

/**
 * 评测框架核心：把 agent 一轮的「每一次出网调用」都打上时延与来源标签。
 *
 * 只依赖配置判定来源（classifyUrl），不依赖 runner 内部实现：
 * 这样换上优化后的 runAgentTurn2，同一套打桩依然成立。
 *
 * 时延分两段记：
 * - headerMs：发请求到响应头回来（LLM 的「排队 + 首 token 前」近似值）；
 * - ms：headerMs + 正文被消费完（LLM 流式输出是大头，只记头会漏掉它）。
 * 正文没被消费就结束时（如调用方根本不看 body），ms 在 finalize 处按已流逝时间封顶。
 */

const MS = Date.now

/** 按配置的上游地址，把一个 URL 归类为 llm / serper / jina / other。不认死字符串。 */
export function classifyUrl(urlString, config) {
  const raw = String(urlString ?? '')
  let parsed
  try {
    parsed = new URL(raw)
  } catch {
    return 'other'
  }
  const base = `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}`
  if (base.startsWith(config.baseUrl)) return 'llm'
  if (config.serperBase && base.startsWith(config.serperBase)) return 'serper'
  if (config.jinaBase && base.startsWith(config.jinaBase)) return 'jina'
  return 'other'
}

/** 包一层正文流：消费完（含 cancel）时回调 onDone；包不动就原样返回。 */
function tapBody(response, onDone) {
  const body = response?.body
  if (!body || typeof body.getReader !== 'function') return response
  const reader = body.getReader()
  const stream = new ReadableStream({
    async pull(controller) {
      const { done, value } = await reader.read()
      if (done) {
        controller.close()
        onDone()
        return
      }
      controller.enqueue(value)
    },
    async cancel(reason) {
      try {
        await reader.cancel(reason)
      } finally {
        onDone()
      }
    },
  })
  return new Response(stream, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  })
}

/**
 * 包一层 fetch：每次调用记一条 { kind, url, headerMs, ms }。
 * ms 在正文消费完时落定；事件列表原样进报告，供事后逐跳排查。
 */
export function createInstrumentedFetch(innerFetch, config) {
  const events = []
  const fetchImpl = async (url, init) => {
    const started = MS()
    const event = { kind: classifyUrl(url, config), url: String(url), headerMs: null, ms: null }
    events.push(event)
    let response
    try {
      response = await innerFetch(url, init)
    } catch (cause) {
      // 调用在拿到响应前就抛错（限流、超时、连接断）：到抛错点的耗时也是
      // 真实成本，丢成 0ms 会把「慢而失败」记成「快而失败」，时延归因失真。
      event.headerMs = MS() - started
      event.ms = event.headerMs
      event.error = true
      throw cause
    }
    event.headerMs = MS() - started
    const finish = () => {
      if (event.ms === null) event.ms = MS() - started
    }
    const tapped = tapBody(response, finish)
    if (tapped === response) finish()
    return tapped
  }
  /** runner 结束后调用：没被消费正文的事件按当前时刻封顶，保证 ms 非空。 */
  const finalize = () => {
    for (const event of events) {
      if (event.ms === null) event.ms = event.headerMs ?? 0
    }
  }
  return { fetchImpl, events, finalize }
}

function emptyMetrics() {
  return {
    totalMs: 0,
    firstDeltaMs: null,
    llmCalls: 0,
    llmHeaderMs: 0,
    llmMs: 0,
    serperCalls: 0,
    serperMs: 0,
    serperWallMs: 0,
    jinaCalls: 0,
    jinaMs: 0,
    jinaWallMs: 0,
    otherCalls: 0,
    otherMs: 0,
    contentLen: 0,
    hasLinks: false,
    steps: [],
    events: [],
  }
}

/**
 * 跑一道题，返回这道题的时延结构。
 * runner 是 runAgentTurn 的同签名实现（可换成优化版）。
 * question 形如 { id, expectedToolUse, text }。
 */
export async function runQuestion({ runner = runAgentTurn, config, question, fetchImpl = fetch }) {
  const metrics = emptyMetrics()
  const { fetchImpl: instrumented, events, finalize } = createInstrumentedFetch(fetchImpl, config)
  let streamed = ''
  const started = MS()
  try {
    const result = await runner(
      config,
      [{ role: 'user', content: question.text }],
      instrumented,
      (step) => metrics.steps.push({ tool: step.tool, detail: step.detail }),
      (delta) => {
        if (metrics.firstDeltaMs === null) metrics.firstDeltaMs = MS() - started
        streamed += delta
      },
      () => {},
    )
    streamed = streamed === '' ? String(result.content ?? '') : streamed
  } catch (cause) {
    metrics.error = cause instanceof Error ? cause.message : String(cause)
  }
  metrics.totalMs = MS() - started
  finalize()
  for (const event of events) {
    metrics[`${event.kind}Calls`] += 1
    metrics[`${event.kind}Ms`] += event.ms
    // 同批并发调用的壁钟近似 = 该批最慢一次；跨多批时各批串联，这里取最大单跳作代表
    const wallField = `${event.kind}WallMs`
    if (wallField in metrics) metrics[wallField] = Math.max(metrics[wallField], event.ms)
    const headerField = `${event.kind}HeaderMs`
    if (headerField in metrics) metrics[headerField] += event.headerMs ?? event.ms
  }
  metrics.contentLen = streamed.length
  metrics.hasLinks = /https?:\/\/\S+/u.test(streamed)
  metrics.events = events.map(({ kind, url, headerMs, ms }) => ({ kind, url, headerMs, ms }))
  return metrics
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

function medianNullable(values) {
  const numeric = values.filter((v) => v !== null)
  return numeric.length === 0 ? null : median(numeric)
}

const MEDIAN_FIELDS = [
  'totalMs',
  'llmCalls',
  'llmHeaderMs',
  'llmMs',
  'serperCalls',
  'serperMs',
  'serperWallMs',
  'jinaCalls',
  'jinaMs',
  'jinaWallMs',
  'contentLen',
]

function medianMetrics(runs) {
  const out = { firstDeltaMs: medianNullable(runs.map((r) => r.firstDeltaMs)) }
  for (const field of MEDIAN_FIELDS) out[field] = median(runs.map((r) => r[field]))
  out.hasLinks = runs.filter((r) => r.hasLinks).length > runs.length / 2
  return out
}

/**
 * 把一组运行结果（多题 × 多次）聚合成一份报告。
 * 输入形如 { questions: [{ id, expectedToolUse, runs: [metrics...] }], meta }。
 * 原始 runs（含逐跳 events 与 steps）原样保留在报告里，供事后排查。
 */
export function aggregateRuns({ questions, meta = {} }) {
  const reportQuestions = questions.map((q) => {
    const failed = q.runs.filter((r) => r.error)
    const succeeded = q.runs.filter((r) => !r.error)
    const base = succeeded.length > 0 ? succeeded : q.runs
    return {
      id: q.id,
      expectedToolUse: q.expectedToolUse,
      runs: q.runs.length,
      median: medianMetrics(base),
      errors: failed.map((r) => r.error),
      rawRuns: q.runs,
    }
  })
  const totalList = reportQuestions.map((q) => q.median.totalMs)
  return {
    meta: { generatedAt: new Date().toISOString(), ...meta },
    summary: {
      questionCount: reportQuestions.length,
      medianTotalMs: totalList.length === 0 ? 0 : median(totalList),
      totalErrors: reportQuestions.reduce((sum, q) => sum + q.errors.length, 0),
    },
    questions: reportQuestions,
  }
}

/**
 * 把两份报告按题拼在一起算差值。
 * deltaMs 为 候选 - 基准；deltaPct 为基准为 0 时的 null。
 */
export function compareReports(baseline, candidate) {
  const byId = new Map(candidate.questions.map((q) => [q.id, q]))
  const rows = baseline.questions.map((bq) => {
    const cand = byId.get(bq.id)
    const baseMs = bq.median.totalMs
    const candMs = cand ? cand.median.totalMs : null
    const deltaMs = candMs === null ? null : candMs - baseMs
    const deltaPct = deltaMs === null || baseMs === 0 ? null : Math.round((deltaMs / baseMs) * 100)
    return {
      id: bq.id,
      expectedToolUse: bq.expectedToolUse,
      baseMs,
      candMs,
      deltaMs,
      deltaPct,
      baseMedian: bq.median,
      candMedian: cand ? cand.median : null,
    }
  })
  const baseSummary = baseline.summary.medianTotalMs
  const candSummary = candidate.summary.medianTotalMs
  const summaryDelta = candSummary - baseSummary
  return {
    baseline: baseline.meta.tag ?? 'baseline',
    candidate: candidate.meta.tag ?? 'candidate',
    summary: {
      baseMs: baseSummary,
      candMs: candSummary,
      deltaMs: summaryDelta,
      deltaPct: baseSummary === 0 ? null : Math.round((summaryDelta / baseSummary) * 100),
    },
    rows,
  }
}
