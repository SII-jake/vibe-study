import { describe, expect, it, vi } from 'vitest'
import { streamChat } from '../src/ai/provider'

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
      messages: [{ role: 'user', content: 'hi' }],
      fetchImpl: fetchImpl as unknown as typeof fetch,
      onDelta: (delta) => received.push(delta),
      signal: new AbortController().signal,
    })
    expect(received).toEqual(['复利', '是'])
  })

  it('只请求本机 /api/chat，不携带任何密钥', async () => {
    const fetchImpl = mockFetch(async () => sseResponse(['data: [DONE]\n\n']))
    await streamChat({
      messages: [{ role: 'user', content: 'hi' }],
      model: 'chosen-model',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      onDelta: () => {},
      signal: new AbortController().signal,
    })
    const [url, init] = fetchImpl.mock.calls[0]!
    expect(url).toBe('/api/chat')
    expect(init?.headers).toEqual({ 'Content-Type': 'application/json' })
    expect(JSON.stringify(init?.headers ?? {})).not.toMatch(/authorization/i)
    expect(JSON.parse(init?.body as string)).toEqual({
      messages: [{ role: 'user', content: 'hi' }],
      model: 'chosen-model',
    })
  })

  it('响应非 2xx 时抛出带响应体信息的错误', async () => {
    const fetchImpl = mockFetch(async () => new Response('{"error":"invalid key"}', { status: 401 }))
    await expect(
      streamChat({
        messages: [{ role: 'user', content: 'hi' }],
        fetchImpl: fetchImpl as unknown as typeof fetch,
        onDelta: () => {},
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow(/invalid key/)
  })
})
