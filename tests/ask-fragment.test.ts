// @vitest-environment jsdom
// 片段级锚点贯通（decisions/2026-11-19 §一）：askAt 的锚点三元组 =
// anchorMessageId + fragmentIndex + anchorText；无 fragmentIndex 的旧选区 → null。
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { editMessage, regenerateReply, continueReply } from '../web/src/services/chat/store.js'
import type { Session, UserMessage } from '../web/src/services/chat/types.js'

vi.mock('../web/src/services/api/client.js', () => ({
  streamMessage: vi.fn(),
  readTask: vi.fn(async () => null),
  streamTaskEvents: vi.fn(async function* () {}),
  cancelTask: vi.fn(async () => {}),
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

// 真机反馈③：追问的引子卡与 lane 顶行展示模型生成的短标题——
// 由该轮追问的回答流向服务端申请 title.enabled，回落写分支根 user
// 消息的 ask.title；主线会话标题不受影响。
describe('追问标题通路（ask.title 由模型生成）', () => {
  beforeEach(async () => {
    const { useChatStore } = await import('../web/src/services/chat/store.js')
    useChatStore.setState({
      ready: true,
      sessions: [{ id: 's1', title: '已有标题', createdAt: 1, updatedAt: 1 }],
      sessionCache: {},
      activeId: null,
      streaming: {},
      importingHistory: false,
    })
  })

  it('追问即使会话已有标题也申请 title.enabled，并把回落 title 写进 ask.title', async () => {
    const { useChatStore } = await import('../web/src/services/chat/store.js')
    const session: Session = {
      id: 's1',
      title: '已有标题',
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
    useChatStore.setState({ sessionCache: { s1: session } })

    // mock 流式：先断言请求里 title.enabled=true（会话已有标题但追问仍申请），
    // 再回放一个带 title 的 message_delta 事件
    const { streamMessage } = await import('../web/src/services/api/client.js')
    let capturedBody: unknown = null
    ;(streamMessage as ReturnType<typeof vi.fn>).mockImplementation(
      async function* (_apiKey: string, body: unknown) {
        capturedBody = body
        yield {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text', text: '' },
        }
        yield {
          type: 'message_delta',
          delta: { stop_reason: 'end_turn', title: '这个追问在聊什么' },
        }
      },
    )

    const { askAt } = await import('../web/src/services/chat/store.js')
    const branchRootId = askAt('s1', 'a1', '被选原文', '问什么', 0)
    expect(branchRootId).toBeTruthy()
    // 流式是 fire-and-forget——等其消费完事件
    await new Promise((r) => setTimeout(r, 50))

    expect((capturedBody as { title?: { enabled: boolean } }).title?.enabled).toBe(true)
    const fresh = useChatStore.getState().sessionCache['s1']
    const askMsg = fresh?.messages.find(
      (m): m is UserMessage => m.role === 'user' && (m as UserMessage).ask?.anchorMessageId === 'a1',
    )
    expect(askMsg?.ask?.title).toBe('这个追问在聊什么')
    // 主线标题不动
    expect(fresh?.title).toBe('已有标题')
  })
})


// 真机反馈⑥：追问层里编辑追问的提问——两个缺陷：（1）editMessage 从主线
// 可见链找被编辑消息，追问分支不在主线链上，findIndex=-1 静默返回 false
// （用户看到"点了没反应"）。（2）即使路径对，新建的追问版本不再带 ask 字段，
// 追问被静默降级成普通提问——引子卡消失、追问层不再认得它。
// 修法：editMessage 增加 laneRootId 以重根链取代主线链；追问消息用新的
// 内容封装（「引用 + 追问」同一格式），ask 字段原样保留。
describe('追问层编辑追问（真机反馈⑥）', () => {
  it('追问不在主线链上也可编辑，编辑后仍为追问且 ask 保留', async () => {
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
          id: 'a1', role: 'assistant', createdAt: 2, model: null, prefix: true, status: 'done',
          parentId: 'u1', blocks: [{ type: 'text', text: '答' }],
        } as any,
        {
          id: 'q1', role: 'user', createdAt: 3, parentId: 'a1', selectedChildId: 'r1',
          content: '你在回答中写过这段内容：\n\n> 被选原文\n\n我的追问：问什么', files: [],
          ask: { anchorText: '被选原文', anchorMessageId: 'a1', fragmentIndex: 0 },
        },
        {
          id: 'r1', role: 'assistant', createdAt: 4, model: null, prefix: true, status: 'done',
          parentId: 'q1', blocks: [{ type: 'text', text: '追问答' }],
        } as any,
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

    // 追问层：lane 根是 q1——编辑在其中能找到 q1 并发起新版
    const ok = editMessage('s1', 'q1', '改成另一句追问', 'q1')
    expect(ok).toBe(true)

    const fresh = useChatStore.getState().sessionCache['s1']!
    const next = fresh.messages.find(
      (m): m is UserMessage =>
        m.role === 'user' && (m.content ?? '').includes('改成另一句追问'),
    )
    expect(next).toBeTruthy()
    // 仍是追问：ask 三元组原样保留
    expect(next?.ask?.anchorText).toBe('被选原文')
    expect(next?.ask?.anchorMessageId).toBe('a1')
    // 内容仍按「引用 + 追问」同一封装格式（模型语义不跑题）
    expect(next?.content).toContain('你在回答中写过这段内容：')
    expect(next?.content).toContain('我的追问：改成另一句追问')
  })

  it('不传 laneRootId 的旧调用对追问仍返回 false（主线链外不猜）', async () => {
    const { useChatStore } = await import('../web/src/services/chat/store.js')
    const session: Session = {
      id: 's1',
      title: '测试',
      createdAt: 1,
      updatedAt: 1,
      rootMessageId: 'u1',
      messages: [
        { id: 'u1', role: 'user', content: '问', files: [], createdAt: 1, selectedChildId: 'a1' },
        { id: 'a1', role: 'assistant', createdAt: 2, model: null, prefix: true, status: 'done', parentId: 'u1', blocks: [{ type: 'text', text: '答' }] } as any,
        {
          id: 'q1', role: 'user', createdAt: 3, parentId: 'a1', selectedChildId: 'r1',
          content: '你在回答中写过这段内容：\n\n> 被选原文\n\n我的追问：问什么', files: [],
          ask: { anchorText: '被选原文', anchorMessageId: 'a1', fragmentIndex: 0 },
        },
        { id: 'r1', role: 'assistant', createdAt: 4, model: null, prefix: true, status: 'done', parentId: 'q1', blocks: [{ type: 'text', text: '答' }] } as any,
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
    expect(editMessage('s1', 'q1', '改成另一句追问')).toBe(false)
  })
})


// 真机反馈⑦：追问层里点重试/继续生成无反应——regenerateReply/continueReply
// 都从主线可见链找 question==user + assistant==尾的结构，追问分支不在主线链，
// 校验静默 return。修法：两动作支持 laneRootId 以重根链取代主线链。
describe('追问层重试/续写（真机反馈⑦）', () => {
  const seed = async (status: 'done' | 'error') => {
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
          id: 'a1', role: 'assistant', createdAt: 2, model: null, prefix: true, status: 'done',
          parentId: 'u1', blocks: [{ type: 'text', text: '答' }],
        } as any,
        {
          id: 'q1', role: 'user', createdAt: 3, parentId: 'a1', selectedChildId: 'r1',
          content: '你在回答中写过这段内容：\n\n> 被选原文\n\n我的追问：问什么', files: [],
          ask: { anchorText: '被选原文', anchorMessageId: 'a1', fragmentIndex: 0 },
        },
        {
          id: 'r1', role: 'assistant', createdAt: 4, model: null, prefix: true, status,
          parentId: 'q1', blocks: [{ type: 'text', text: '一半' }],
        } as any,
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

  it('追问层里的 regenerateReply：发起流式且追问回答被重置', async () => {
    await seed('done')
    const { useChatStore } = await import('../web/src/services/chat/store.js')
    regenerateReply('s1', 'r1', 'q1')
    const fresh = useChatStore.getState().sessionCache['s1']!
    // 流式被触发（streaming map 出现该会话入口），且新回答作为 q1 的新分支落库
    const streaming = useChatStore.getState().streaming
    expect(Object.keys(streaming).length).toBeGreaterThan(0)
    expect(fresh.messages.filter((m) => m.parentId === 'q1' && m.role === 'assistant').length)
      .toBe(2)
  })

  it('追问层里的 continueReply（本地打断尾部）：续写发起流式不走新建', async () => {
    await seed('stopped' as 'done')
    // canContinueReply 判定过往实现："有内容且错误未完成"——继续读后按原样输入
    const { useChatStore } = await import('../web/src/services/chat/store.js')
    continueReply('s1', 'r1', 'q1')
    const streaming = useChatStore.getState().streaming
    expect(Object.keys(streaming).length).toBeGreaterThan(0)
  })
})
