// /api/tasks 接线：把「生成」从 HTTP 连接里摘出来，连接只订阅。
// 核心口径（用户 2026-11-26）：刷新页面只断开订阅，上游流继续跑；
// 重新订阅按 since 回放即可接上。这条若破，刷新就会把回复掐成半截。
//
// 任务 id 走查询参数而不是路径：id 由前端的 streamKeyOf 生成，追问 lane 的键
// 含 NUL 分隔符，放进 URL 路径不合法。
import { createServer } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import { createHandler } from '../server/handler.mjs'

const baseConfig = () => ({
  baseUrl: 'https://api.deepseek.com/v1',
  apiKey: '',
  model: 'deepseek-flash',
  models: [],
  serperKey: '',
  serperBase: '',
  jinaKey: '',
  jinaBase: '',
  deepseekKey: 'demo-deepseek-key',
  deepseekBase: 'https://api.deepseek.com',
  shellTools: false,
  auth: { enabled: false, password: '', cookie: 'vibe_auth', ttlDays: 30, secure: true },
})

/** 可控上游：逐帧放行，便于造出「正在跑」的中间态并观察是否被取消 */
function controlledUpstream(frames) {
  const state = { cancelled: false, released: 0, gates: [] }
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    start(controller) {
      let index = 0
      const pump = () => {
        if (index >= frames.length) {
          controller.close()
          return
        }
        controller.enqueue(encoder.encode(frames[index]))
        index += 1
        state.released = index
        if (index < frames.length) {
          void new Promise((resolve) => state.gates.push(resolve)).then(pump)
        } else {
          controller.close()
        }
      }
      pump()
    },
    cancel() {
      state.cancelled = true
    },
  })
  state.next = () => state.gates.shift()?.()
  return { state, response: new Response(stream, { status: 200 }) }
}

const sseBody = (frames) =>
  new Response(frames.join(''), {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  })

async function serve(config, fetchImpl) {
  const server = createServer(createHandler(config, fetchImpl))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  return { base: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(r)) }
}

const startTask = (base, id, body = { messages: [{ role: 'user', content: 'hi' }] }) =>
  fetch(`${base}/api/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, request: body }),
  })
const eventsUrl = (base, id, since) =>
  `${base}/api/tasks/events?id=${encodeURIComponent(id)}${since === undefined ? '' : `&since=${since}`}`
const wait = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms))

const FRAME_START = 'data: {"type":"message_start"}\n\n'
const FRAME_STOP = 'data: {"type":"message_stop"}\n\n'

describe('POST /api/tasks', () => {
  it('建任务即发起上游请求，换密钥并回任务 id 与状态', async () => {
    const fetchImpl = vi.fn(async () => sseBody([FRAME_START, FRAME_STOP]))
    const running = await serve(baseConfig(), fetchImpl)
    const response = await startTask(running.base, 'm1')
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ id: 'm1', status: 'running' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0]
    expect(String(url)).toBe('https://api.deepseek.com/anthropic/v1/messages')
    expect(init.headers['x-api-key']).toBe('demo-deepseek-key')
    await running.close()
  })

  it('请求体原样转发，不增删改', async () => {
    const sent = { messages: [{ role: 'user', content: 'hi' }], stream: true }
    const fetchImpl = vi.fn(async () => sseBody([FRAME_STOP]))
    const running = await serve(baseConfig(), fetchImpl)
    await startTask(running.base, 'm1', sent)
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual(sent)
    await running.close()
  })

  it('同 id 在跑时重复建任务不会起两条上游流', async () => {
    // 上游必须挂在中间态：任务若已结束，同 id 是可以重建的（续写/重试复用同一 lane 键）
    const upstream = controlledUpstream([FRAME_START, FRAME_STOP])
    const fetchImpl = vi.fn(async () => upstream.response)
    const running = await serve(baseConfig(), fetchImpl)
    await startTask(running.base, 'm1')
    await startTask(running.base, 'm1')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    upstream.state.next()
    await wait()
    await running.close()
  })

  it('缺 id 或 request 时 400', async () => {
    const running = await serve(baseConfig(), vi.fn())
    const bad = await fetch(`${running.base}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ request: {} }),
    })
    expect(bad.status).toBe(400)
    await running.close()
  })

  it('未配置 DeepSeek Key 时 503 且不发起上游请求', async () => {
    const fetchImpl = vi.fn()
    const running = await serve({ ...baseConfig(), deepseekKey: '' }, fetchImpl)
    expect((await startTask(running.base, 'm1')).status).toBe(503)
    expect(fetchImpl).not.toHaveBeenCalled()
    await running.close()
  })
})

describe('GET /api/tasks/events（订阅与回放）', () => {
  it('订阅拿到完整流，帧内容与上游一致', async () => {
    const frames = [FRAME_START, FRAME_STOP]
    const running = await serve(baseConfig(), vi.fn(async () => sseBody(frames)))
    await startTask(running.base, 'm1')
    const response = await fetch(eventsUrl(running.base, 'm1'))
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/event-stream')
    const text = await response.text()
    expect(text).toContain('message_start')
    expect(text).toContain('message_stop')
    await running.close()
  })

  it('每帧带 id 游标，供断线重连按 since 续上', async () => {
    const running = await serve(baseConfig(), vi.fn(async () => sseBody([FRAME_START, FRAME_STOP])))
    await startTask(running.base, 'm1')
    const text = await (await fetch(eventsUrl(running.base, 'm1'))).text()
    expect(text).toContain('id: 0')
    expect(text).toContain('id: 1')
    await running.close()
  })

  it('订阅者断开不取消上游：任务照跑，重连能从 0 拿全', async () => {
    const upstream = controlledUpstream([FRAME_START, FRAME_STOP])
    const running = await serve(baseConfig(), vi.fn(async () => upstream.response))
    await startTask(running.base, 'm1')

    // 第一个订阅者连上就断——模拟刷新页面
    const controller = new AbortController()
    const first = await fetch(eventsUrl(running.base, 'm1'), { signal: controller.signal })
    expect(first.status).toBe(200)
    controller.abort()
    await wait()

    // 上游没被掐：这正是「刷新不中断」的根
    expect(upstream.state.cancelled).toBe(false)
    expect(upstream.state.released).toBe(1)

    upstream.state.next()
    await wait()
    const text = await (await fetch(eventsUrl(running.base, 'm1'))).text()
    expect(text).toContain('message_start')
    expect(text).toContain('message_stop')
    expect(upstream.state.cancelled).toBe(false)
    await running.close()
  })

  it('since 跳过已收过的帧', async () => {
    const frames = [
      'data: {"type":"a"}\n\n',
      'data: {"type":"b"}\n\n',
      'data: {"type":"c"}\n\n',
    ]
    const running = await serve(baseConfig(), vi.fn(async () => sseBody(frames)))
    await startTask(running.base, 'm1')
    // 等任务跑完再订阅：since=2 只该拿到最后一帧
    expect((await (await fetch(`${running.base}/api/tasks?id=m1`)).json()).status).toBe('done')
    const text = await (await fetch(eventsUrl(running.base, 'm1', 2))).text()
    expect(text).toContain('"c"')
    expect(text).not.toContain('"a"')
    await running.close()
  })

  it('未知任务 404', async () => {
    const running = await serve(baseConfig(), vi.fn())
    expect((await fetch(eventsUrl(running.base, 'nope'))).status).toBe(404)
    await running.close()
  })
})

describe('DELETE /api/tasks（停止）', () => {
  it('停任务会取消上游，状态记 aborted', async () => {
    const upstream = controlledUpstream([FRAME_START, FRAME_STOP])
    const running = await serve(baseConfig(), vi.fn(async () => upstream.response))
    await startTask(running.base, 'm1')
    expect((await fetch(`${running.base}/api/tasks?id=m1`, { method: 'DELETE' })).status).toBe(200)
    await wait()
    expect(upstream.state.cancelled).toBe(true)
    expect((await (await fetch(`${running.base}/api/tasks?id=m1`)).json()).status).toBe('aborted')
    await running.close()
  })
})
