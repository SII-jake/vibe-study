import { describe, expect, it, vi } from 'vitest'
import { streamChat } from '../src/ai/provider'
import type { AiConfig } from '../src/ai/settings'

const config: AiConfig = {
  baseUrl: 'https://api.example.com/v1',
  apiKey: 'test-key',
  model: 'test-model',
}

function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)))
      controller.close()
    },
  })
  return new Response(stream, { status: 200 })
}

function mockFetch(respond: () => Promise<Response>) {
  return vi.fn((_input: string, _init?: RequestInit) => respond())
}

describe('streamChat', () => {
  it('按增量回调文本', async () => {
    const fetchImpl = mockFetch(async () =>
      sseResponse([
        'data: {"choices":[{"delta":{"content":"复利"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"是"}}]}\n\n',
        'data: [DONE]\n\n',
      ]),
    )
    const received: string[] = []
    await streamChat({
      config,
      messages: [{ role: 'user', content: 'hi' }],
      fetchImpl: fetchImpl as unknown as typeof fetch,
      onDelta: (delta) => received.push(delta),
      signal: new AbortController().signal,
    })
    expect(received).toEqual(['复利', '是'])
  })

  it('请求地址与鉴权头按 OpenAI 兼容约定拼接', async () => {
    const fetchImpl = mockFetch(async () => sseResponse(['data: [DONE]\n\n']))
    await streamChat({
      config,
      messages: [{ role: 'user', content: 'hi' }],
      fetchImpl: fetchImpl as unknown as typeof fetch,
      onDelta: () => {},
      signal: new AbortController().signal,
    })
    const [url, init] = fetchImpl.mock.calls[0]!
    expect(url).toBe('https://api.example.com/v1/chat/completions')
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer test-key')
    expect(JSON.parse(init?.body as string)).toMatchObject({ model: 'test-model', stream: true })
  })

  it('baseUrl 结尾多余斜杠被归一', async () => {
    const fetchImpl = mockFetch(async () => sseResponse(['data: [DONE]\n\n']))
    await streamChat({
      config: { ...config, baseUrl: 'https://api.example.com/v1//' },
      messages: [{ role: 'user', content: 'hi' }],
      fetchImpl: fetchImpl as unknown as typeof fetch,
      onDelta: () => {},
      signal: new AbortController().signal,
    })
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('https://api.example.com/v1/chat/completions')
  })

  it('响应非 2xx 时抛出带响应体信息的错误', async () => {
    const fetchImpl = mockFetch(async () => new Response('{"error":"invalid key"}', { status: 401 }))
    await expect(
      streamChat({
        config,
        messages: [{ role: 'user', content: 'hi' }],
        fetchImpl: fetchImpl as unknown as typeof fetch,
        onDelta: () => {},
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow(/invalid key/)
  })
})
