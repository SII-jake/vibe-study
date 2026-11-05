// 前端对话同步客户端：只调自有 /api/nodes，失败一律降级为 null，不抛错打断主流程。
import { describe, expect, it, vi } from 'vitest'
import { fetchRemoteNodes, pushNodes } from '../src/ai/nodes'
import type { LearnNode } from '../src/domain/tree'

const NODE_A: LearnNode = {
  id: 'n-a',
  parentId: null,
  anchor: null,
  messages: [{ id: 'n-a-m0', role: 'user', content: '什么是复利？', createdAt: 1 }],
  createdAt: 1,
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('fetchRemoteNodes', () => {
  it('GET /api/nodes 取回版本与节点', async () => {
    const fetchImpl = vi.fn(async (_input: string, _init?: RequestInit) =>
      jsonResponse({ version: 3, nodes: [NODE_A] }),
    )
    const remote = await fetchRemoteNodes(fetchImpl as unknown as typeof fetch)
    expect(remote).toEqual({ version: 3, nodes: [NODE_A] })
    expect(fetchImpl.mock.calls[0]![0]).toBe('/api/nodes')
  })

  it('HTTP 错误与网络异常都降级为 null', async () => {
    const bad = vi.fn(async () => new Response('boom', { status: 500 }))
    expect(await fetchRemoteNodes(bad as unknown as typeof fetch)).toBeNull()
    const down = vi.fn(async (): Promise<Response> => {
      throw new Error('network down')
    })
    expect(await fetchRemoteNodes(down as unknown as typeof fetch)).toBeNull()
  })

  it('响应形状不对（缺 version / nodes 非数组）也降级为 null', async () => {
    const weird = vi.fn(async () => jsonResponse({ version: 'x', nodes: [NODE_A] }))
    expect(await fetchRemoteNodes(weird as unknown as typeof fetch)).toBeNull()
    const weird2 = vi.fn(async () => jsonResponse({ version: 1 }))
    expect(await fetchRemoteNodes(weird2 as unknown as typeof fetch)).toBeNull()
  })
})

describe('pushNodes', () => {
  it('PUT /api/nodes 带 baseVersion 与节点，成功时取回新版本', async () => {
    const fetchImpl = vi.fn(async (_input: string, _init?: RequestInit) =>
      jsonResponse({ version: 4 }),
    )
    const result = await pushNodes(
      { baseVersion: 3, nodes: [NODE_A] },
      fetchImpl as unknown as typeof fetch,
    )
    expect(result).toEqual({ ok: true, version: 4 })
    const [url, init] = fetchImpl.mock.calls[0]!
    expect(url).toBe('/api/nodes')
    expect(init?.method).toBe('PUT')
    expect(JSON.parse(init?.body as string)).toEqual({ baseVersion: 3, nodes: [NODE_A] })
    expect(JSON.stringify(init?.headers ?? {})).not.toMatch(/authorization/i)
  })

  it('409 冲突时带回服务端最新版本与节点，供调用方做三路合并', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ version: 5, nodes: [NODE_A] }, 409))
    const result = await pushNodes(
      { baseVersion: 3, nodes: [NODE_A] },
      fetchImpl as unknown as typeof fetch,
    )
    expect(result).toEqual({ ok: false, version: 5, nodes: [NODE_A] })
  })

  it('其它失败与网络异常降级为 null', async () => {
    const bad = vi.fn(async () => new Response('nope', { status: 400 }))
    expect(
      await pushNodes({ baseVersion: 3, nodes: [NODE_A] }, bad as unknown as typeof fetch),
    ).toBeNull()
    const down = vi.fn(async (): Promise<Response> => {
      throw new Error('network down')
    })
    expect(
      await pushNodes({ baseVersion: 3, nodes: [NODE_A] }, down as unknown as typeof fetch),
    ).toBeNull()
  })
})
