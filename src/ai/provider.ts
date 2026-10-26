import { createSseDecoder } from './sse'
import { type AiConfig, normalizeBaseUrl } from './settings'

export interface ProviderMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface StreamChatInput {
  config: AiConfig
  messages: ProviderMessage[]
  onDelta: (delta: string) => void
  signal: AbortSignal
  fetchImpl?: typeof fetch
}

interface StreamChunk {
  choices?: Array<{ delta?: { content?: string } }>
}

/** 以 OpenAI 兼容协议流式取回答，逐段回调文本增量。 */
export async function streamChat(input: StreamChatInput): Promise<void> {
  const fetchImpl = input.fetchImpl ?? fetch
  const response = await fetchImpl(`${normalizeBaseUrl(input.config.baseUrl)}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${input.config.apiKey}`,
    },
    body: JSON.stringify({
      model: input.config.model,
      messages: input.messages,
      stream: true,
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
      const delta = parsed.choices?.[0]?.delta?.content
      if (delta) input.onDelta(delta)
    }
  }
}
