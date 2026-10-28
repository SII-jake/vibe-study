// 前端标题请求：只调自有 /api/title，失败时由调用方回退到原提问。
import { describe, expect, it, vi } from 'vitest'
import { fetchTitle } from '../src/ai/title'

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('fetchTitle', () => {
  it('把提问与回答发给 /api/title，取回标题', async () => {
    const fetchImpl = vi.fn(async (_input: string, _init?: RequestInit) =>
      jsonResponse({ title: '顺风骑行的阻力来源' }),
    )
    const title = await fetchTitle(
      { question: '为什么顺风骑车也感觉吃力？', answer: '因为风阻与速度平方成正比。' },
      fetchImpl as unknown as typeof fetch,
    )

    expect(title).toBe('顺风骑行的阻力来源')
    const [url, init] = fetchImpl.mock.calls[0]!
    expect(url).toBe('/api/title')
    expect(JSON.parse(init?.body as string)).toEqual({
      question: '为什么顺风骑车也感觉吃力？',
      answer: '因为风阻与速度平方成正比。',
    })
  })

  it('不携带任何密钥', async () => {
    const fetchImpl = vi.fn(async (_input: string, _init?: RequestInit) =>
      jsonResponse({ title: 't' }),
    )
    await fetchTitle({ question: 'q', answer: 'a' }, fetchImpl as unknown as typeof fetch)
    const [, init] = fetchImpl.mock.calls[0]!
    expect(JSON.stringify(init?.headers ?? {})).not.toMatch(/authorization/i)
  })

  it('提问为空时不发请求，返回空串', async () => {
    const fetchImpl = vi.fn(async (_input: string, _init?: RequestInit) =>
      jsonResponse({ title: 't' }),
    )
    expect(await fetchTitle({ question: '  ', answer: 'a' }, fetchImpl as unknown as typeof fetch)).toBe('')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('接口失败时返回空串，不抛错打断主流程', async () => {
    const fetchImpl = vi.fn(async (_input: string, _init?: RequestInit) =>
      new Response('boom', { status: 502 }),
    )
    expect(await fetchTitle({ question: 'q', answer: 'a' }, fetchImpl as unknown as typeof fetch)).toBe('')
  })

  it('网络异常同样降级为空串', async () => {
    const fetchImpl = vi.fn(async (_input: string, _init?: RequestInit) => {
      throw new Error('network down')
    })
    expect(await fetchTitle({ question: 'q', answer: 'a' }, fetchImpl as unknown as typeof fetch)).toBe('')
  })
})
