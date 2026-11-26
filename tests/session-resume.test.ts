// @vitest-environment jsdom
// 刷新页面不中断生成（用户 2026-11-26：续接范围只到「刷新页面不中断」，任务存内存即可）。
//
// 修复前：页面一关就把半截回复收成 stopped，服务端流也被 cancel——刷新必然断。
// 目标口径：加载会话时先问服务端「这个生成任务还在吗」，在就接上继续收，
// 只有服务端确实没有这个任务（进程重启/过期）才收成 stopped。
//
// 接续的正确性要点：本地已存了半截块，而任务事件是从起点整段回放的，
// 直接叠加会让块重复。任务记录起始块数（baseBlocks），重连时裁回起点再重放。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Message, Session } from '../web/src/services/chat/types.js'

vi.mock('../web/src/services/api/client.js', () => ({
  streamMessage: vi.fn(async function* () {}),
  readTask: vi.fn(),
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

const tick = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms))

type Asst = Extract<Message, { role: 'assistant' }>

/** 「刷新前生成到一半」的单轮会话：回复停在 streaming，本地已有半截块 */
const pendingSession = (blocks: Asst['blocks']): Session => ({
  id: 's1',
  title: '测试',
  createdAt: 1,
  updatedAt: 10,
  rootMessageId: 'u1',
  messages: [
    { id: 'u1', role: 'user', content: '问', files: [], createdAt: 1, selectedChildId: 'a1' },
    {
      id: 'a1',
      role: 'assistant',
      createdAt: 2,
      model: null,
      prefix: true,
      status: 'streaming',
      parentId: 'u1',
      blocks,
    },
  ],
})

/** 追问会话：主问答已完成，追问 lane 的回复停在 streaming */
const askSession = (blocks: Asst['blocks']): Session => ({
  id: 's1',
  title: '测试',
  createdAt: 1,
  updatedAt: 10,
  rootMessageId: 'u1',
  messages: [
    { id: 'u1', role: 'user', content: '问', files: [], createdAt: 1, selectedChildId: 'a1' },
    {
      id: 'a1',
      role: 'assistant',
      createdAt: 2,
      model: null,
      prefix: true,
      status: 'done',
      parentId: 'u1',
      selectedChildId: 'q1',
      blocks: [{ type: 'text', text: '答' }],
    },
    {
      id: 'q1',
      role: 'user',
      content: '追问',
      files: [],
      createdAt: 3,
      parentId: 'a1',
      selectedChildId: 'a2',
      ask: { anchorText: '答', anchorMessageId: 'a1' },
    },
    {
      id: 'a2',
      role: 'assistant',
      createdAt: 4,
      model: null,
      prefix: true,
      status: 'streaming',
      parentId: 'q1',
      blocks,
    },
  ],
})

const seed = async (stored: Session) => {
  const db = await import('../web/src/services/chat/db.js')
  ;(db.loadSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(stored)
  const { useChatStore } = await import('../web/src/services/chat/store.js')
  useChatStore.setState({
    ready: true,
    sessions: [{ id: 's1', title: '测试', createdAt: 1, updatedAt: 10 }],
    sessionCache: {},
    activeId: null,
    streaming: {},
    importingHistory: false,
  })
}

/** 服务端任务快照（readTask 的返回值） */
const stubReadTask = async (snapshot: unknown) => {
  const client = await import('../web/src/services/api/client.js')
  ;(client.readTask as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(snapshot)
}

/** 让订阅回放指定事件；gate 用来把「接续中」的中间态留住 */
const stubReplay = async (
  events: Array<Record<string, unknown>>,
  options: { gate?: Promise<void> } = {},
) => {
  const client = await import('../web/src/services/api/client.js')
  ;(client.streamTaskEvents as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    async function* () {
      for (const event of events) {
        yield event
      }
      if (options.gate) {
        await options.gate
      }
    },
  )
}

const loadSession = async () => {
  const store = await import('../web/src/services/chat/store.js')
  store.selectSession('s1')
  await tick()
  return store
}

const replyOf = (state: { sessionCache: Record<string, Session> }, id = 'a1'): Asst | undefined =>
  state.sessionCache['s1']?.messages.find((m): m is Asst => m.id === id && m.role === 'assistant')

const textOf = (reply: Asst | undefined) =>
  (reply?.blocks ?? []).map((block) => (block.type === 'text' ? block.text : ''))

beforeEach(async () => {
  const client = await import('../web/src/services/api/client.js')
  ;(client.readTask as unknown as ReturnType<typeof vi.fn>).mockReset()
  ;(client.streamTaskEvents as unknown as ReturnType<typeof vi.fn>).mockReset()
  // cancelTask 只清调用记录：mockReset 会连实现一起清掉，停止路径上
  // `cancelTask(...).catch(...)` 就会拿到 undefined 而炸掉
  ;(client.cancelTask as unknown as ReturnType<typeof vi.fn>).mockClear()
})

describe('刷新后重新接上生成', () => {
  it('服务端任务还在跑：把本地半截块裁回起点整段重放，文本不重复', async () => {
    await seed(pendingSession([{ type: 'text', text: '前半' }]))
    await stubReadTask({ id: 'a1', status: 'running', baseBlocks: 0 })
    await stubReplay([
      { type: 'message_start', message: { id: 'x', model: 'm' } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '前半' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '后半' } },
      { type: 'message_stop' },
    ])

    const store = await loadSession()
    await tick()

    const reply = replyOf(store.useChatStore.getState())
    expect(reply?.status).toBe('done')
    // 修复前的错误形态是「前半前半后半」（本地半截 + 整段重放）
    expect(textOf(reply)).toEqual(['前半后半'])
  })

  it('接续期间该 lane 处于生成中，界面仍能显示停止', async () => {
    let open!: () => void
    const gate = new Promise<void>((resolve) => {
      open = resolve
    })
    await seed(pendingSession([{ type: 'text', text: '前半' }]))
    await stubReadTask({ id: 'a1', status: 'running', baseBlocks: 0 })
    await stubReplay(
      [
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '前半' } },
        { type: 'message_stop' },
      ],
      { gate },
    )

    const store = await loadSession()
    expect(store.isLaneStreaming('s1', null)).toBe(true)
    open()
    await tick()
    expect(store.isLaneStreaming('s1', null)).toBe(false)
  })

  it('服务端没有这个任务（进程重启或已过期）：收成 stopped，不傻等', async () => {
    await seed(pendingSession([{ type: 'text', text: '前半' }]))
    await stubReadTask(null)

    const store = await loadSession()
    await tick()

    expect(replyOf(store.useChatStore.getState())?.status).toBe('stopped')
  })

  it('续写场景：裁回 baseBlocks 时保住续写前缀块', async () => {
    // 续写在原回答后追加，任务起点已有 1 个块（原答案）
    await seed(
      pendingSession([
        { type: 'text', text: '原答案' },
        { type: 'text', text: '续写半截' },
      ]),
    )
    await stubReadTask({ id: 'a1', status: 'running', baseBlocks: 1 })
    await stubReplay([
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '续写半截' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '尾巴' } },
      { type: 'message_stop' },
    ])

    const store = await loadSession()
    await tick()

    expect(textOf(replyOf(store.useChatStore.getState()))).toEqual(['原答案', '续写半截尾巴'])
  })

  it('追问 lane 的回复按 lane 根接续，键与实时生成一致', async () => {
    await seed(askSession([]))
    await stubReadTask({ id: 'a2', status: 'running', baseBlocks: 0 })
    await stubReplay([
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '追问答' } },
      { type: 'message_stop' },
    ])

    const store = await loadSession()
    await tick()

    const reply = replyOf(store.useChatStore.getState(), 'a2')
    expect(reply?.status).toBe('done')
    expect(textOf(reply)).toEqual(['追问答'])
    // 接续用的键与实时生成同源，完成后退订
    expect(store.useChatStore.getState().streaming[store.streamKeyOf('s1', 'q1')]).toBeUndefined()
  })

  it('任务已结束：把残留内容补完并收成 done，不再等', async () => {
    await seed(pendingSession([{ type: 'text', text: '前半' }]))
    await stubReadTask({ id: 'a1', status: 'done', baseBlocks: 0 })
    await stubReplay([
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '前半结尾' } },
      { type: 'message_stop' },
    ])

    const store = await loadSession()
    await tick()

    expect(replyOf(store.useChatStore.getState())?.status).toBe('done')
    expect(textOf(replyOf(store.useChatStore.getState()))).toEqual(['前半结尾'])
  })

  it('任务被停止过：接回来的回复收成 stopped', async () => {
    await seed(pendingSession([]))
    await stubReadTask({ id: 'a1', status: 'aborted', baseBlocks: 0 })
    await stubReplay([])

    const store = await loadSession()
    await tick()

    expect(replyOf(store.useChatStore.getState())?.status).toBe('stopped')
  })

  it('任务以 error 结束：接回来的回复收成 error 并带上服务端原因', async () => {
    await seed(pendingSession([{ type: 'text', text: '前半' }]))
    await stubReadTask({ id: 'a1', status: 'error', error: '上游断了', baseBlocks: 0 })
    await stubReplay([
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '前半' } },
    ])

    const store = await loadSession()
    await tick()

    const reply = replyOf(store.useChatStore.getState())
    expect(reply?.status).toBe('error')
    expect(reply?.error?.message).toBe('上游断了')
    // 失败前收到的内容要留住，不能因为报错就清空
    expect(textOf(reply)).toEqual(['前半'])
  })

  it('接续中点停止：连服务端任务一起停，不只断本地订阅', async () => {
    let open!: () => void
    const gate = new Promise<void>((resolve) => {
      open = resolve
    })
    await seed(pendingSession([]))
    await stubReadTask({ id: 'a1', status: 'running', baseBlocks: 0 })
    await stubReplay(
      [{ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
      { gate },
    )

    const store = await loadSession()
    const client = await import('../web/src/services/api/client.js')
    store.stopReply('s1', null)

    // 只 abort 本地订阅的话，上游会继续烧额度跑完，刷新回来还会被接回去
    expect(client.cancelTask).toHaveBeenCalledWith('a1')
    open()
    await tick()
    expect(replyOf(store.useChatStore.getState())?.status).toBe('stopped')
  })
})
