import { createSseDecoder } from './sse'

export interface ProviderMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface StreamChatInput {
  messages: ProviderMessage[]
  /** 从服务端 /api/health 拿到的模型名；为空时由服务端决定 */
  model?: string
  onDelta: (delta: string) => void
  /** 服务端推送的工具动作（如"正在搜索：xxx"）；可选 */
  onStatus?: (status: string) => void
  /**
   * 服务端要求清空已显示的增量。
   * 模型可能先吐一句"我查一下"再决定调工具，那段话不是最终答案，
   * 服务端会发 reset 让前端把已渲染的部分丢掉。
   */
  onReset?: () => void
  signal: AbortSignal
  fetchImpl?: typeof fetch
}

interface StreamChunk {
  choices?: Array<{ delta?: { content?: string } }>
  /** 工具动作说明，非 OpenAI 字段，仅本服务使用 */
  status?: string
  /** 清空已显示增量的信号，非 OpenAI 字段，仅本服务使用 */
  reset?: boolean
}

/** 调用本机服务端的 /api/chat，由服务端注入密钥并转发上游。 */
export async function streamChat(input: StreamChatInput): Promise<void> {
  const fetchImpl = input.fetchImpl ?? fetch
  const response = await fetchImpl('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: input.messages,
      model: input.model ?? '',
    }),
    signal: input.signal,
  })

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`接口返回 ${response.status}${detail ? `：${detail}` : ''}`)
  }
  if (!response.body) throw new Error('接口未返回可读数据流')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const sse = createSseDecoder()

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    const chunk = decoder.decode(value, { stream: true })
    for (const event of sse.push(chunk)) {
      if (event.data === '[DONE]') return
      const parsed = JSON.parse(event.data) as StreamChunk
      if (parsed.reset) {
        input.onReset?.()
        continue
      }
      if (parsed.status) {
        input.onStatus?.(parsed.status)
        continue
      }
      const delta = parsed.choices?.[0]?.delta?.content
      if (delta) input.onDelta(delta)
    }
  }
}
