// 客户端任务通道：POST /api/tasks 建任务、GET …/events 订阅回放、DELETE 停止。
// 刷新能续接的前提是这几条契约稳定：任务 id 由调用方给定（= 回复消息 id，
// 已随会话落盘），重连只要带 id 就能把全部帧重放出来。
import { beforeEach, describe, expect, it, vi } from 'vitest'

// client.ts 顶层读构建期注入的 __API_ORIGIN__
vi.hoisted(() => {
  ;(globalThis as Record<string, unknown>).__API_ORIGIN__ = 'http://test.local'
})

const { ApiError, cancelTask, createTask, readTask, streamTaskEvents } = await import(
  '../web/src/services/api/client.js'
)

const sse = (frames: string[]) =>
  new Response(frames.join(''), {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  })

const stubFetch = (impl: (url: string, init?: RequestInit) => Promise<Response>) => {
  const spy = vi.fn(impl)
  vi.stubGlobal('fetch', spy)
  return spy
}

beforeEach(() => {
  vi.unstubAllGlobals()
})

describe('createTask', () => {
  it('POST /api/tasks，body 为 { id, request }', async () => {
    const fetchSpy = stubFetch(async () =>
      Response.json({ id: 'm1', status: 'running' }, { status: 200 }),
    )
    const snapshot = await createTask('m1', { messages: [{ role: 'user', content: 'hi' }] })
    const [url, init] = fetchSpy.mock.calls[0]
    // 同源相对路径：node 环境没有 window，与 ANTHROPIC_BASE_URL 的构造惯例一致
    expect(String(url)).toBe('/api/tasks')
    expect(init?.method).toBe('POST')
    // stream: true 由通道自己补——服务端原样转发请求体，不会再帮它加
    expect(JSON.parse(String(init?.body))).toEqual({
      id: 'm1',
      request: { messages: [{ role: 'user', content: 'hi' }], stream: true },
    })
    expect(snapshot).toEqual({ id: 'm1', status: 'running' })
  })
})

describe('readTask', () => {
  it('404 视为「服务端没有这个任务」返回 null，而不是抛错', async () => {
    stubFetch(async () => Response.json({ error: '未知任务' }, { status: 404 }))
    expect(await readTask('gone')).toBeNull()
  })

  it('200 回任务快照', async () => {
    stubFetch(async () => Response.json({ id: 'm1', status: 'done', error: null }, { status: 200 }))
    expect(await readTask('m1')).toEqual({ id: 'm1', status: 'done', error: null })
  })
})

describe('cancelTask', () => {
  it('DELETE /api/tasks?id=…，让服务端停掉上游', async () => {
    const fetchSpy = stubFetch(async () => Response.json({ id: 'm1', status: 'aborted' }))
    await cancelTask('m1')
    const [url, init] = fetchSpy.mock.calls[0]
    expect(String(url)).toBe('/api/tasks?id=m1')
    expect(init?.method).toBe('DELETE')
  })
})

describe('streamTaskEvents', () => {
  it('按 SSE 帧还原成事件，直到 message_stop 结束', async () => {
    stubFetch(async () =>
      sse([
        'id: 0\ndata: {"type":"message_start","message":{"id":"x","model":"m"}}\n\n',
        'id: 1\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
        'id: 2\ndata: {"type":"message_stop"}\n\n',
      ]),
    )
    const types: string[] = []
    for await (const event of streamTaskEvents('m1', 0, new AbortController().signal)) {
      types.push(event.type)
    }
    expect(types).toEqual(['message_start', 'content_block_start', 'message_stop'])
  })

  it('错误帧抛 ApiError(stream)', async () => {
    stubFetch(async () => sse(['id: 0\ndata: {"type":"error","error":{"message":"上游爆了"}}\n\n']))
    const events = streamTaskEvents('m1', 0, new AbortController().signal)
    await expect(events.next()).rejects.toBeInstanceOf(ApiError)
  })

  it('没等到 message_stop 就断流，抛 interrupted', async () => {
    stubFetch(async () =>
      sse(['id: 0\ndata: {"type":"message_start","message":{"id":"x","model":"m"}}\n\n']),
    )
    const events = streamTaskEvents('m1', 0, new AbortController().signal)
    await events.next()
    await expect(events.next()).rejects.toMatchObject({ kind: 'interrupted' })
  })

  it('带 since 请求，供断线重连续上', async () => {
    const fetchSpy = stubFetch(async () => sse(['id: 3\ndata: {"type":"message_stop"}\n\n']))
    for await (const _event of streamTaskEvents('m1', 3, new AbortController().signal)) {
      // 消费完
    }
    expect(String(fetchSpy.mock.calls[0][0])).toContain('since=3')
  })
})
