import { executeTool, fetchUserUrls } from './tools.mjs'

/**
 * 工具循环的轮次上限：超过就强制模型停止调用，直接总结作答。
 * 搜索已打包成「一次调用拿多角度结果」，不需要再多轮扩散；
 * 4 轮工具 + 1 轮兜底终答 = LLM 调用封顶 6 次，避免轮次失控拖长时延。
 */
const MAX_LLM_CALLS = 5

/** 告诉模型有哪些工具、什么时候用。 */
const TOOL_GUIDE = [
  '1. 用户在消息里给出网页链接时，页面正文已由服务端自动抓回注入上下文。\n',
  '   这些正文就是该链接的权威内容，你直接阅读作答，不要用 search 去找那个页面、\n',
  '   也不要为「交叉验证」去搜同一主题。抓取失败处会标注原因，那时才允许搜。\n',
  '2. 其余需要用 search（联网搜索，一次调用检索并返回各结果的内容摘要）的情况：\n',
  '   涉及时效信息、事实核查、具体数据或来源时，先想清楚要核实的几个角度，\n',
  '   把它们作为多个关键词放在一次 search 调用的 queries 里（2-4 个），只调一次。\n',
  '3. 返回的摘要通常已足够作答；引用你实际看到的内容才能写进答案，不能说成\n',
  '   "逐段读过原文"。回答注明来源链接，对于不一致的口径要明说矛盾。\n',
  '4. 每次提问最多调 1-2 次 search：结果不够也先用手头材料作答，不要一轮一轮\n',
  '   地追加扩散。概念讲解、逻辑推导、已给出原文的追问不需要搜索。',
  '5. run_bash / run_python 本机执行工具：需要系统当下状态（当前时间、环境、\n',
  '   已装软件版本），或要验证一段代码的真实行为时，直接跑一段最小程序作答，\n',
  '   比凭记忆断言更可靠。只在确实需要系统事实或验证代码行为时调用；\n',
  '   命令保持短平快，不要做与作答无关的系统改动。\n',
].join('')

export const TOOL_DEFS = [
  {
    type: 'function',
    function: {
      name: 'search',
      description: '联网搜索：一次传入多个关键词，返回各结果的标题、链接与内容摘要（不抓网页正文）。需要时效信息、事实或来源时使用。',
      parameters: {
        type: 'object',
        properties: {
          queries: {
            type: 'array',
            items: { type: 'string' },
            description: '多个搜索关键词（不同侧重），一次调用并行检索',
          },
        },
        required: ['queries'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_bash',
      description: '在服务器本机执行一段 bash 命令，回传 stdout、stderr 与退出码。用于取系统当下状态（当前时间、环境、版本）或验证 shell 行为。',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: '要执行的 shell 命令' },
          timeoutMs: { type: 'number', description: '超时毫秒数（默认 30000，封顶 120000）' },
        },
        required: ['command'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_python',
      description: '用 python3 执行一段 python 代码，回传打印输出与退出码。用于验证一段代码的真实行为或做精确计算。',
      parameters: {
        type: 'object',
        properties: {
          code: { type: 'string', description: '要执行的 python 源码' },
          timeoutMs: { type: 'number', description: '超时毫秒数（默认 30000，封顶 120000）' },
        },
        required: ['code'],
      },
    },
  },
]

/** 解析上游 SSE 数据流，屏蔽 chunk 边界与注释行。 */
export function createSseParser() {
  let buffer = ''
  return {
    push(chunk) {
      buffer += chunk.replace(/\r\n/g, '\n')
      const events = []
      let separator = buffer.indexOf('\n\n')
      while (separator >= 0) {
        const block = buffer.slice(0, separator)
        buffer = buffer.slice(separator + 2)
        const data = block
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart())
          .join('\n')
        if (data !== '') events.push(data)
        separator = buffer.indexOf('\n\n')
      }
      return events
    },
  }
}

/**
 * 连接层抖动。
 *
 * 上游（及中间的 TLS / 反向代理）会空闲回收 keep-alive 连接；连接池把新请求
 * 发到一条刚要关闭的 socket 上时，undici 抛 `TypeError: fetch failed` 或
 * `TypeError: terminated`。工具循环两轮之间隔着搜索与读网页，几十秒不碰上游，
 * 最容易撞上。这类错误与请求内容无关，属于可安全重试的抖动。
 */
function isRetryableNetworkError(cause) {
  if (!(cause instanceof Error)) return false
  return /fetch failed|terminated|ECONNRESET|EPIPE|socket hang up|other side closed/i.test(
    cause.message,
  )
}

/** 重试之间的退避；抖动通常在几十毫秒内自愈，不需要长等。 */
function retryDelay(attempt) {
  return new Promise((resolve) => setTimeout(resolve, attempt * 120))
}

/**
 * 调一次模型（带抖动重试）。
 *
 * 只在「还没往外吐过任何增量」时重试：已经吐过内容再重来一遍，
 * 前端会看到重复文字。重试次数有上限，避免上游故障被放大成请求风暴。
 */
async function callLlm(config, messages, fetchImpl, onDelta = () => {}) {
  const MAX_ATTEMPTS = 3
  let lastError

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    let emitted = false
    try {
      return await callLlmOnce(config, messages, fetchImpl, (delta) => {
        emitted = true
        onDelta(delta)
      })
    } catch (cause) {
      lastError = cause
      const canRetry =
        !emitted && isRetryableNetworkError(cause) && attempt < MAX_ATTEMPTS
      if (!canRetry) throw cause
      await retryDelay(attempt)
    }
  }

  throw lastError
}

/**
 * 单次模型调用。
 *
 * 默认走流式：边收边通过 onDelta 回调，前端因此能增量渲染，
 * 而不是等全文到齐再一次性出现。工具调用在流式协议里同样是分片的
 * （id / name / arguments 分多条下发），这里按 index 拼回完整结构。
 *
 * 请求整体配有超时：挂起的请求（上游卡住不收发数据）会被中止，
 * 以「可重试的连接抖动」形式回到调用方，走有限次重试，不再让用户无限等。
 *
 * 上游若返回非 SSE（含测试桩），退化为一次性 JSON 解析，行为与过去一致。
 */
async function callLlmOnce(config, messages, fetchImpl, onDelta = () => {}) {
  // config.llmTimeoutMs 缺失时给一个保守下限；默认值在 config 解析里定
  const timeoutMs = config.llmTimeoutMs > 0 ? config.llmTimeoutMs : 60_000

  /*
   * 整体超时不能依赖上游 fetch 是否尊重 AbortSignal：
   * 有的实现（包括部分测试桩和异常路径）会忽略 signal 仍挂起。
   * 因此用一层 Promise.race 兜底 —— 超过 timeoutMs 未收到响应，
   * 就以可重试的连接抖动形式上抛，进入有限次重试。
   */
  const timeoutError = new Error(`fetch failed: 上游请求超过 ${timeoutMs}ms 未响应`)
  let response
  try {
    response = await Promise.race([
      fetchImpl(`${config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({ model: config.model, messages, tools: TOOL_DEFS, stream: true }),
        signal: AbortSignal.timeout(timeoutMs),
      }),
      new Promise((_, reject) => {
        setTimeout(() => reject(timeoutError), timeoutMs)
      }),
    ])
  } catch (cause) {
    if (cause === timeoutError) throw cause
    if (cause?.name === 'TimeoutError' || /timed out|timeout/i.test(cause?.message ?? '')) {
      throw new Error(`fetch failed: 上游请求超过 ${timeoutMs}ms 未响应`)
    }
    throw cause
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`模型接口返回 ${response.status}：${detail}`)
  }

  const contentType = response.headers?.get?.('content-type') ?? ''
  if (!contentType.includes('text/event-stream') || !response.body) {
    const body = await response.text().catch(() => '')
    const parsed = JSON.parse(body)
    const choice = parsed.choices?.[0]
    if (!choice?.message) throw new Error('模型接口没有返回 message')
    const content = choice.message.content ?? ''
    if (content) onDelta(content)
    return choice.message
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const sse = createSseParser()
  const toolCalls = []
  let content = ''
  let finished = false

  try {
    while (!finished) {
      const { done, value } = await reader.read()
      if (done) break
      for (const data of sse.push(decoder.decode(value, { stream: true }))) {
        if (data === '[DONE]') {
          finished = true
          break
        }
        let parsed
        try {
          parsed = JSON.parse(data)
        } catch {
          // 上游偶发非 JSON 心跳行，跳过而不是让整轮失败
          continue
        }
        const delta = parsed.choices?.[0]?.delta
        if (!delta) continue
        if (typeof delta.content === 'string' && delta.content !== '') {
          content += delta.content
          onDelta(delta.content)
        }
        for (const piece of delta.tool_calls ?? []) {
          const index = piece.index ?? 0
          const slot = (toolCalls[index] ??= {
            id: '',
            type: 'function',
            function: { name: '', arguments: '' },
          })
          if (piece.id) slot.id = piece.id
          if (piece.function?.name) slot.function.name += piece.function.name
          if (piece.function?.arguments) slot.function.arguments += piece.function.arguments
        }
      }
    }
  } finally {
    /*
     * 必须释放响应体。
     * 上游发完 [DONE] 往往不会立刻断开，这里若只是 break，连接会带着
     * 未读完的数据回到连接池；工具循环紧接着再发请求复用这条坏连接，
     * 就会以 `TypeError: fetch failed` 失败 —— 表现为前端收到
     * 「服务暂时异常」。cancel 让底层 socket 被丢弃而不是复用。
     */
    try {
      await reader.cancel()
    } catch {
      // 流已正常结束或已关闭，取消失败无需处理
    }
  }

  return { content, tool_calls: toolCalls.filter(Boolean) }
}

function parseArguments(raw) {
  try {
    return JSON.parse(raw ?? '{}')
  } catch {
    return {}
  }
}

/** 从消息文本里抓出 http(s) 链接（尾部标点剥掉）。 */
const URL_PATTERN = /https?:\/\/[^\s"'<>（）「」『』\]]+/gu
function extractUrls(text) {
  return [...new Set(
    String(text ?? '')
      .match(URL_PATTERN)
      ?.map((u) => u.replace(/[.,;:!?，。；：！？、…）)》】『」]+$/, '')) ?? [],
  )]
}

/**
 * 用户消息里给出的网页：服务端自动抓回正文注入上下文。
 * 这是「正文抓取」的唯一触发路径——模型不能自己决定抓页面（search 永不抓），
 * 用户给链接意味着「读这个」，服务端 deterministic 地满足它。
 * 只扫 user 消息：assistant/tool 消息里的 URL 是模型自己生成的，不算用户指定。
 */
async function injectUserPages(config, messages, history, fetchImpl, onStep) {
  const urls = [...new Set(
    messages.filter((m) => m?.role === 'user').flatMap((m) => extractUrls(m.content)),
  )]
  if (urls.length === 0) return
  for (const url of urls) onStep({ tool: 'read_url', detail: url })
  const pages = await fetchUserUrls(config, urls, fetchImpl)
  const list = pages
    .map((page) => `### ${page.url}\n${page.content.trim() === '' ? '（未取到内容）' : page.content}`)
    .join('\n\n')
  history.push({
    role: 'system',
    content: [
      '用户在消息中给出了网页链接，以下正文列表已由服务端自动抓回（jina）。请基于这些正文作答；抓取失败处已标注原因：',
      list,
    ].join('\n\n'),
  })
}

/**
 * 跑一轮 agent 对话：模型决定要调工具就执行并回填，直到直接作答或触达轮次上限。
 * onStep 用于把工具调用轨迹带回给调用方（如搜索了什么、读了哪个页面）。
 *
 * onDelta 把最终回答的增量实时交出去，前端因此能边收边渲染；
 * onReset 用于模型「先说话又决定调工具」的情况 —— 那段话不是最终答案，
 * 必须让前端清掉已显示的部分，否则会把中途独白留在答案里。
 */
export async function runAgentTurn(
  config,
  messages,
  fetchImpl = fetch,
  onStep = () => {},
  onDelta = () => {},
  onReset = () => {},
) {
  const history = [
    { role: 'system', content: TOOL_GUIDE },
    ...messages,
  ]
  // 正文抓取的唯一触发路径：用户消息带链接，服务端 deterministic 抓取注入
  await injectUserPages(config, messages, history, fetchImpl, onStep)

  for (let callIndex = 0; callIndex < MAX_LLM_CALLS; callIndex += 1) {
    /** 本轮是否已经往外吐过文字 */
    let spoke = false
    const message = await callLlm(config, history, fetchImpl, (delta) => {
      spoke = true
      onDelta(delta)
    })
    const toolCalls = message.tool_calls ?? []

    // 说了话又决定调工具：那段话不是答案，通知前端清空
    if (toolCalls.length > 0 && spoke) onReset()

    // 最后一轮仍然想调工具：不执行，让模型用已有信息作答。
    if (toolCalls.length > 0 && callIndex + 1 >= MAX_LLM_CALLS) {
      history.push({ role: 'assistant', content: message.content ?? '', tool_calls: toolCalls })
      for (const toolCall of toolCalls) {
        history.push({ role: 'tool', tool_call_id: toolCall.id, content: '已达到工具调用轮次上限' })
      }
      const finalMessage = await callLlm(config, history, fetchImpl, onDelta)
      return { content: finalMessage.content ?? '' }
    }

    if (toolCalls.length === 0) {
      return { content: message.content ?? '' }
    }

    history.push({
      role: 'assistant',
      content: message.content ?? null,
      tool_calls: toolCalls,
    })

    // 同一轮的工具调用互不依赖（模型一次给出的多个搜索/读页面），并发执行。
    // 串行会让 N 个请求的耗时相加，是长回答变慢的主要来源之一。
    const results = await Promise.all(
      toolCalls.map(async (toolCall) => {
        const name = toolCall.function?.name ?? ''
        const args = parseArguments(toolCall.function?.arguments)
        /** 打包 search 的关键词列表（兼容模型偶尔发出的单字符串 query）。 */
        const queries =
          args.queries ?? (typeof args.query === 'string' ? [args.query] : [])
        // 状态行摘要：search 用关键词列表；shell 工具用命令本身（截断防爆状态栏）
        const commandText = typeof args.command === 'string' ? args.command : typeof args.code === 'string' ? args.code : ''
        const detail =
          queries.length > 0 ? queries.join('、') : commandText.trim().replace(/\s+/g, ' ').slice(0, 60)
        onStep({ tool: name, detail })
        try {
          return await executeTool(config, name, args, fetchImpl)
        } catch (cause) {
          return `工具执行失败：${cause.message}`
        }
      }),
    )

    // 按 tool_calls 原顺序回填，结果与 tool_call_id 一一对应，不受完成先后影响。
    toolCalls.forEach((toolCall, index) => {
      history.push({ role: 'tool', tool_call_id: toolCall.id, content: String(results[index]) })
    })
  }

  // 理论上到不了这里；兜底不再循环。
  return { content: '' }
}
