// @vitest-environment jsdom
// 同一会话内两条追问分支并发生成（用户在 2026-11-26 明确要求）：
// 「生成中」的判定原来按会话粒度（streaming 以 sessionId 为键），任何一条 lane
// 在跑就把整个会话锁住——主线生成时发起追问被静默拒绝，反之亦然。
// 目标口径：以 lane 为单位。同一 lane 内仍互斥（同一条回答不能同时跑两份流），
// 不同 lane 各跑各的；停止按钮只停它所在的那条 lane。
import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { Session } from '../web/src/services/chat/types.js'

vi.mock('../web/src/services/api/client.js', () => ({
  streamMessage: vi.fn(),
  readTask: vi.fn(async () => null),
  streamTaskEvents: vi.fn(async function* () {}),
  cancelTask: vi.fn(async () => {}),
  ApiError: class ApiError extends Error {},
}))
vi.mock('../web/src/services/chat/db.js', () => ({
  saveSession: vi.fn(async () => {}),
  loadSession: vi.fn(async () => undefined),
  loadAllSessions: vi.fn(async () => []),
  loadSessionSummaries: vi.fn(async () => []),
  deleteSession: vi.fn(async () => {}),
  renameSession: vi.fn(async () => {}),
  saveFiles: vi.fn(async () => {}),
  loadFile: vi.fn(async () => undefined),
  clearStaging: vi.fn(async () => {}),
  addStagingSession: vi.fn(async () => {}),
  saveStagingFiles: vi.fn(async () => {}),
  updateStagingFileTypes: vi.fn(async () => {}),
  commitStaging: vi.fn(async () => []),
  reportStorageError: vi.fn(() => () => {}),
}))

/** 每条流在产出首块后挂在自己那道闸门上，测试逐条放行——这样才能造出"同时在跑" */
const gates = new Map<string, { promise: Promise<void>; open: () => void }>()
const gateFor = (text: string) => {
  let open!: () => void
  const promise = new Promise<void>((resolve) => {
    open = resolve
  })
  const gate = { promise, open: () => open() }
  gates.set(text, gate)
  return gate
}
const lastUserText = (body: unknown) => {
  const messages = (body as { messages?: { role: string; content: unknown }[] }).messages ?? []
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role === 'user') {
      const content = message.content
      return typeof content === 'string' ? content : JSON.stringify(content)
    }
  }
  return ''
}
const tick = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms))
const keys = async () => {
  const { useChatStore } = await import('../web/src/services/chat/store.js')
  return Object.keys(useChatStore.getState().streaming)
}

const seed = async () => {
  const { useChatStore } = await import('../web/src/services/chat/store.js')
  const session: Session = {
    id: 's1',
    title: '测试',
    createdAt: 1,
    updatedAt: 1,
    rootMessageId: 'u1',
    messages: [
      { id: 'u1', role: 'user', content: '开头问', files: [], createdAt: 1, selectedChildId: 'a1' },
      {
        id: 'a1',
        role: 'assistant',
        createdAt: 2,
        model: null,
        prefix: true,
        status: 'done',
        parentId: 'u1',
        blocks: [{ type: 'text', text: '开头答' }],
      },
    ],
  }
  useChatStore.setState({
    ready: true,
    sessions: [{ id: 's1', title: '测试', createdAt: 1, updatedAt: 1 }],
    sessionCache: { s1: session },
    activeId: 's1',
    streaming: {},
    importingHistory: false,
  })
}

describe('同一会话内两条 lane 并发生成', () => {
  beforeEach(async () => {
    gates.clear()
    const { streamMessage } = await import('../web/src/services/api/client.js')
    ;(streamMessage as unknown as ReturnType<typeof vi.fn>).mockImplementation(async function* (
      _apiKey: string,
      body: unknown,
      signal: AbortSignal,
    ) {
      const text = lastUserText(body)
      const gate = gateFor(text)
      yield { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }
      yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: `答:${text}` } }
      await Promise.race([
        gate.promise,
        new Promise((_, reject) => {
          signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
        }),
      ])
      yield { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null } }
    })
    await seed()
  })

  it('主线生成中仍可在追问分支发起生成，两条同时存在', async () => {
    const { sendMessage, askAt, streamKeyOf } = await import('../web/src/services/chat/store.js')
    const { setDraftText } = await import('../web/src/services/chat/drafts.js')
    setDraftText('s1', '主线新问题')
    expect(sendMessage('s1', null)).toBe(true)
    await tick()
    expect(await keys()).toEqual(['s1'])

    const branchRootId = askAt('s1', 'a1', '被选原文', '追问问题', 0)
    expect(typeof branchRootId).toBe('string')
    await tick()

    expect(streamKeyOf('s1', null)).toBe('s1')
    expect((await keys()).sort()).toEqual(['s1', streamKeyOf('s1', branchRootId as string)].sort())
    gates.get('主线新问题')?.open()
    gates.get('追问问题')?.open()
    await tick()
  })

  it('同一 lane 内仍互斥：同一条回答不能同时跑两份流', async () => {
    const { regenerateReply, useChatStore } = await import('../web/src/services/chat/store.js')
    regenerateReply('s1', 'a1')
    await tick()
    const before = useChatStore.getState().sessionCache['s1']!
    regenerateReply('s1', 'a1')
    const after = useChatStore.getState().sessionCache['s1']!
    // 第二次被挡：a1 下没有多出新的 assistant 版本
    expect(after.messages.filter((m) => m.parentId === 'u1' && m.role === 'assistant').length).toBe(
      before.messages.filter((m) => m.parentId === 'u1' && m.role === 'assistant').length,
    )
    gates.get('开头问')?.open()
    await tick()
  })

  it('同一锚点连发两条追问：各自 lane 独立，互不阻塞', async () => {
    const { askAt, streamKeyOf } = await import('../web/src/services/chat/store.js')
    const first = askAt('s1', 'a1', '被选原文', '追问甲', 0)
    const second = askAt('s1', 'a1', '被选原文', '追问乙', 1)
    expect(typeof first).toBe('string')
    expect(typeof second).toBe('string')
    await tick()
    expect((await keys()).sort()).toEqual(
      [streamKeyOf('s1', first as string), streamKeyOf('s1', second as string)].sort(),
    )
    gates.get('追问甲')?.open()
    gates.get('追问乙')?.open()
    await tick()
  })

  it('停止只作用于所在 lane，另一条继续跑', async () => {
    const { sendMessage, askAt, stopReply, useChatStore } = await import('../web/src/services/chat/store.js')
    const { setDraftText } = await import('../web/src/services/chat/drafts.js')
    setDraftText('s1', '主线新问题')
    sendMessage('s1', null)
    const branchRootId = askAt('s1', 'a1', '被选原文', '追问问题', 0) as string
    await tick()
    expect((await keys()).length).toBe(2)

    stopReply('s1', branchRootId)
    await tick()
    // 追问 lane 收尾退出，主线 lane 仍在跑
    expect(await keys()).toEqual(['s1'])
    const session = useChatStore.getState().sessionCache['s1']!
    const stopped = session.messages.find((m) => m.role === 'assistant' && m.status === 'stopped')
    expect(stopped).toBeTruthy()
    const streaming = session.messages.filter((m) => m.role === 'assistant' && m.status === 'streaming')
    expect(streaming.length).toBeGreaterThan(0)
    gates.get('主线新问题')?.open()
    await tick()
  })

  it('删会话停掉该会话所有 lane 的生成', async () => {
    const { sendMessage, askAt, removeSession } = await import('../web/src/services/chat/store.js')
    const { setDraftText } = await import('../web/src/services/chat/drafts.js')
    setDraftText('s1', '主线新问题')
    sendMessage('s1', null)
    askAt('s1', 'a1', '被选原文', '追问问题', 0)
    await tick()
    expect((await keys()).length).toBe(2)

    await removeSession('s1')
    await tick()
    expect(await keys()).toEqual([])
    gates.get('主线新问题')?.open()
    gates.get('追问问题')?.open()
  })

  it('isLaneStreaming 按 lane 判定，不把别的 lane 算进来', async () => {
    const { askAt, isLaneStreaming } = await import('../web/src/services/chat/store.js')
    const branchRootId = askAt('s1', 'a1', '被选原文', '追问问题', 0) as string
    await tick()
    expect(isLaneStreaming('s1', branchRootId)).toBe(true)
    expect(isLaneStreaming('s1', null)).toBe(false)
    expect(isLaneStreaming('s1', 'nope')).toBe(false)
    gates.get('追问问题')?.open()
    await tick()
  })
})
