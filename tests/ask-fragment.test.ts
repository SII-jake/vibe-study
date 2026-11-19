// @vitest-environment jsdom
// 片段级锚点贯通（decisions/2026-11-19 §一）：askAt 的锚点三元组 =
// anchorMessageId + fragmentIndex + anchorText；无 fragmentIndex 的旧选区 → null。
import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { Session, UserMessage } from '../web/src/services/chat/types.js'

vi.mock('../web/src/services/api/client.js', () => ({
  streamMessage: vi.fn(),
  ApiError: class ApiError extends Error {},
}))
// db.ts 真实导出名（grep '^export' 核实）；store.ts 的 persist 走 saveSession，
// 测试环境没有 IndexedDB——mock 拦截持久化层，断言目标是 ask 内存数据
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

describe('askAt 携带片段级锚点', () => {
  beforeEach(async () => {
    const { useChatStore } = await import('../web/src/services/chat/store.js')
    useChatStore.setState({
      ready: true,
      sessions: [],
      sessionCache: {},
      activeId: null,
      streaming: {},
      importingHistory: false,
    })
  })

  const seedSession = async () => {
    const { useChatStore } = await import('../web/src/services/chat/store.js')
    const session: Session = {
      id: 's1',
      title: '测试',
      createdAt: 1,
      updatedAt: 1,
      rootMessageId: 'u1',
      messages: [
        { id: 'u1', role: 'user', content: '问', files: [], createdAt: 1 },
        {
          id: 'a1',
          role: 'assistant',
          createdAt: 2,
          model: null,
          prefix: true,
          status: 'done',
          blocks: [{ type: 'text', text: '答' }],
        },
      ],
    }
    useChatStore.setState({
      sessionCache: { s1: session },
      sessions: [{ id: 's1', title: '测试', createdAt: 1, updatedAt: 1 }],
    })
    return session
  }

  it('fragmentIndex 落进 ask 三元组', async () => {
    await seedSession()
    const { askAt, useChatStore } = await import('../web/src/services/chat/store.js')
    // 新契约（第三步主体）：askAt 返回新建追问分支的根消息 id——pane 规则
    // planPlaceChild 的 childId 唯一来源；失败仍返回 false，布尔判真语义不变
    const branchRootId = askAt('s1', 'a1', '被选原文', '问什么', 2)
    expect(branchRootId).toBeTruthy()
    expect(typeof branchRootId).toBe('string')
    const session = useChatStore.getState().sessionCache['s1']
    if (!session) throw new Error('session 播种缺失')
    const askMsg = session.messages.find(
      (m): m is UserMessage => m.role === 'user' && (m as UserMessage).ask?.anchorMessageId === 'a1',
    )
    expect(askMsg?.ask?.fragmentIndex).toBe(2)
    expect(askMsg?.id).toBe(branchRootId)
  })

  it('不传 fragmentIndex 的旧调用退化为 null（消息级兼容）', async () => {
    await seedSession()
    const { askAt, useChatStore } = await import('../web/src/services/chat/store.js')
    const branchRootId = askAt('s1', 'a1', '被选原文', '问什么')
    expect(branchRootId).toBeTruthy()
    const session = useChatStore.getState().sessionCache['s1']
    if (!session) throw new Error('session 播种缺失')
    const askMsg = session.messages.find(
      (m): m is UserMessage => m.role === 'user' && (m as UserMessage).ask?.anchorMessageId === 'a1',
    )
    expect(askMsg?.ask?.fragmentIndex).toBeNull()
    expect(askMsg?.id).toBe(branchRootId)
  })
})
