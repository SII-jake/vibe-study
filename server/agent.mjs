import { executeTool } from './tools.mjs'

/** 工具循环的轮次上限：超过就强制模型停止调用，直接总结作答。 */
const MAX_LLM_CALLS = 12

/** 告诉模型有哪些工具、什么时候用。 */
const TOOL_GUIDE = [
  '你可以使用 search（联网搜索）与 read_url（读取网页正文），该应用用于学习场景，对最新知识要求高。',
  '涉及时效信息、事实核查、具体数据或来源时：宁可多查也要查全，不能只凭印象作答。通常执行方式：',
  '1) 先多角度搜索几轮（不同侧重、近一年资料优先），从结果里挑出值得深入的条目用 read_url 打开核对；',
  '2) 事实与摘要里看到的要区分，引用页面上看到的内容才能写进答案；',
  '3) 回答注明来源链接，对于不一致的口径要明说矛盾。',
  '概念讲解、逻辑推导、已给出原文的追问不需要搜索。',
  '预算足够可以多查，不需要为响应速度牺牲完整性。',
].join('')

export const TOOL_DEFS = [
  {
    type: 'function',
    function: {
      name: 'search',
      description: '联网搜索，返回相关网页的标题、链接与摘要。需要时效信息、事实或来源时使用。',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: '搜索关键词' } },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_url',
      description: '读取指定网页的正文内容。搜索结果值得展开时使用。',
      parameters: {
        type: 'object',
        properties: { url: { type: 'string', description: 'http(s) 网页地址' } },
        required: ['url'],
      },
    },
  },
]

async function callLlm(config, messages, fetchImpl) {
  const response = await fetchImpl(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({ model: config.model, messages, tools: TOOL_DEFS }),
  })
  const body = await response.text().catch(() => '')
  if (!response.ok) throw new Error(`模型接口返回 ${response.status}：${body}`)
  const parsed = JSON.parse(body)
  const choice = parsed.choices?.[0]
  if (!choice?.message) throw new Error('模型接口没有返回 message')
  return choice.message
}

function parseArguments(raw) {
  try {
    return JSON.parse(raw ?? '{}')
  } catch {
    return {}
  }
}

/**
 * 跑一轮 agent 对话：模型决定要调工具就执行并回填，直到直接作答或触达轮次上限。
 * onStep 用于把工具调用轨迹带回给调用方（如搜索了什么、读了哪个页面）。
 */
export async function runAgentTurn(config, messages, fetchImpl = fetch, onStep = () => {}) {
  const history = [
    { role: 'system', content: TOOL_GUIDE },
    ...messages,
  ]
  /** 本次实际 read_url 打开过的网页来源；最终作答前注入，确保引用落到答案里。 */
  const readSources = new Set()
  let sourcesInjected = false

  /** 已读来源注入一次；返回是否真的注入了（注入后应再调一次 LLM，让回答带引用）。 */
  const injectSourcesOnce = () => {
    if (sourcesInjected || readSources.size === 0) return false
    sourcesInjected = true
    const list = [...readSources].map((source) => `- ${source}`).join('\n')
    history.push({
      role: 'system',
      content: ['本轮对话实际打开并读过以下网页。请基于这些来源组织最终答案，并在答案中注明来源链接，不要只凭摘要或记忆综述：', list].join('\n'),
    })
    return true
  }

  for (let callIndex = 0; callIndex < MAX_LLM_CALLS; callIndex += 1) {
    const message = await callLlm(config, history, fetchImpl)
    const toolCalls = message.tool_calls ?? []

    // 最后一轮仍然想调工具：不执行，让模型用已有信息作答。
    if (toolCalls.length > 0 && callIndex + 1 >= MAX_LLM_CALLS) {
      history.push({ role: 'assistant', content: message.content ?? '', tool_calls: toolCalls })
      for (const toolCall of toolCalls) {
        history.push({ role: 'tool', tool_call_id: toolCall.id, content: '已达到工具调用轮次上限' })
      }
      injectSourcesOnce()
      const finalMessage = await callLlm(config, history, fetchImpl)
      return { content: finalMessage.content ?? '' }
    }

    if (toolCalls.length === 0) {
      // 模型想直接作答：若读过的来源还没注入，先注入再重问一次，避免全文无引用。
      if (injectSourcesOnce()) {
        callIndex -= 1
        continue
      }
      return { content: message.content ?? '' }
    }

    history.push({
      role: 'assistant',
      content: message.content ?? null,
      tool_calls: toolCalls,
    })

    for (const toolCall of toolCalls) {
      const name = toolCall.function?.name ?? ''
      const args = parseArguments(toolCall.function?.arguments)
      onStep({ tool: name, detail: String(args.query ?? args.url ?? '') })
      if (name === 'read_url') {
        const source = String(args.url ?? '').trim()
        if (source) readSources.add(source)
      }
      let result
      try {
        result = await executeTool(config, name, args, fetchImpl)
      } catch (cause) {
        result = `工具执行失败：${cause.message}`
      }
      history.push({ role: 'tool', tool_call_id: toolCall.id, content: String(result) })
    }
  }

  // 理论上到不了这里；兜底不再循环。
  return { content: '' }
}
