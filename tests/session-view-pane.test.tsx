// @vitest-environment jsdom
// SessionView 桌面接线（decisions/2026-11-19 §二.4/§三.1 同一轨道理）：
// 桌面选中追问后不再用浮动 AskPopover，而是 AskPane 呈于右栏（起草位）；
// 手机端沿用浮动 Popover。本测试钉住桌面呈右栏的接线契约。
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Session } from '../web/src/services/chat/types.js'

// jsdom 无 ResizeObserver——SessionView 渲染链（MessageList/CodeBlock 等）引用它
// jsdom 的 Range.getBoundingClientRect 全零——SessionView 在停顿后读快照矩形
// 判空会返回 null（设计如此，防操作中手柄轨迹）；桩一个不为零的矩形让流程走下去
vi.hoisted(() => {
  Range.prototype.getBoundingClientRect = function () {
    return { top: 200, left: 100, width: 88, height: 24, bottom: 224, right: 188, x: 100, y: 200, toJSON: () => ({}) } as DOMRect
  }
  ;(globalThis as Record<string, unknown>).ResizeObserver =
    (globalThis as Record<string, unknown>).ResizeObserver ??
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false, // desktop：'not all and (min-width: 768px)' 在桌面为 false
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      onchange: null,
      dispatchEvent: () => false,
    }),
  })
})
const { SessionView } = await import('../web/src/components/session/SessionView.js')

// api/client.ts 真实导出名（grep '^export' 核实）：API_ORIGIN 是编译期注入的全局值，
// 测试里没有——mock 给一个字符串；request/uploadFile 也一起挡住避免意外走真实网络
vi.mock('../web/src/services/api/client.js', () => ({
  API_ORIGIN: 'http://test.local',
  // streamMessage 真实契约是 async generator（for await 消费）——mock 成
  // 永不 yield 的异步生成器，流式挂起不推进；本例断言不依赖流式内容
  streamMessage: vi.fn(async function* () {}),
  request: vi.fn(async () => new Response()),
  verifyApiKey: vi.fn(async () => {}),
  uploadFile: vi.fn(async () => ({ id: 'f1' })),
  deleteFile: vi.fn(async () => {}),
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

// SessionView 顶层 const query = window.matchMedia(...) 会在静态 import 加载时
// 立即调用——此时本文件里的 Object.defineProperty 早已跑（提升顺序是同模块内
// 依次执行），但 vitest 会在静态 import 求值前先求模块顶层副作用。
// 用 vi.hoisted 让桩在执行前挂上，再动态 import 组件。

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root
beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

const baseSession = (): Session => ({
  id: 's1',
  title: '主线',
  createdAt: 1,
  updatedAt: 1,
  // 显式分支链：dump 探查实证——只有给齐 parentId+selectedChildId 与 rootMessageId，
  // getVisibleMessages 走出的可见链才含全部两条消息（否则片段宿主只得 1 个）
  rootMessageId: 'u1',
  messages: [
    { id: 'u1', role: 'user', content: '开头问', files: [], createdAt: 1, parentId: null, selectedChildId: 'a1' },
    // 渲染走 buildReplyView(reply.blocks)——content/parts 都不是渲染输入；
    // TextPart 的 text 拼成 answer.markdown → Markdown 顶层两段 → 两个片段宿主
    {
      id: 'a1',
      role: 'assistant',
      createdAt: 2,
      model: null,
      prefix: true,
      status: 'done',
      parentId: 'u1',
      blocks: [{ type: 'text' as const, text: '第一段正文。\n\n**第二段正文。**' }],
    } as any,
  ],
})

// store 播种（与生产一致的前置：App 从 sessionCache 取活 session 传给 SessionView）。
// askAt 校验走 store（ready + sessionCache + 无流式），不播种则一律返回 false。
// 返回 store 里的那一份，渲染与持久化断言同对象。
const seedStore = async (session: Session) => {
  const { useChatStore } = await import('../web/src/services/chat/store.js')
  useChatStore.setState({
    ready: true,
    importingHistory: false,
    sessions: [{ id: session.id, title: session.title, createdAt: session.createdAt, updatedAt: session.updatedAt }],
    sessionCache: { [session.id]: session as never },
    activeId: session.id,
    streaming: {},
  })
  return useChatStore.getState().sessionCache[session.id] as Session
}
// 生产里 askAt 改 store 后 App 会把新 session 重新传入；测试手动等价一次
const rerenderWithFreshSession = async (sessionId: string) => {
  const { useChatStore } = await import('../web/src/services/chat/store.js')
  const fresh = useChatStore.getState().sessionCache[sessionId] as Session
  act(() => {
    root.render(<SessionView session={fresh} siderCollapsed={false} />)
  })
}

describe('桌面端选中追问 → 右栏 AskPane（非浮动 Popover）', () => {
  it('点击操作条追问后，AskPane 出现且无 AskPopover 层', async () => {
    const session = baseSession()
    act(() => {
      root.render(<SessionView session={session} siderCollapsed={false} />)
    })
    const fragments = container.querySelectorAll('[data-fragment-index]')
    expect(fragments.length).toBe(2)
    // 选区目标取 <strong> 元素本身：TextContent 渲染为 <span>，strong.firstChild
    // 是元素节点而非文本节点；selectNodeContents 传元素由 Range 框住其全部内容。
    const frag = fragments[1]
    if (!frag) throw new Error('第二片段宿主缺失')
    const target = frag.querySelector('strong') ?? frag
    expect(target).toBeTruthy()
    const range = document.createRange()
    range.selectNodeContents(target)
    const sel = window.getSelection()!
    sel.removeAllRanges()
    sel.addRange(range)
    act(() => { document.dispatchEvent(new Event('selectionchange')) })
    // 操作条有 350ms 停顿防抖（防拖选中途遮罩盖手柄）
    await act(async () => { await new Promise((r) => setTimeout(r, 450)) })

    const askBtn = [...container.querySelectorAll('button')].find((b) => b.textContent?.includes('追问'))
    expect(askBtn).toBeTruthy()
    act(() => { (askBtn as HTMLButtonElement).click() })

    // 桌面：右栏 AskPane 起草（顶钉"就这段提问"）；浮动 AskPopover 不应出现
    expect(container.textContent).toContain('就这段提问')
    expect(container.querySelector('[data-ask-panel]')).toBeNull()
  }, 20000)
})

// 第三步主体（decisions/2026-11-19 §二.1/§二.3）：起草只是右栏的占位形态，
// 提交后子对话要落进右栏、中栏原位保留父对话——四条 pane 规则的 placeChild 接线。
describe('桌面端提交追问 → 子对话进右栏（placeChild）', () => {
  it('在 AskPane 提交后，右栏渲染子对话链且仍带数据轨', async () => {
    const session = await seedStore(baseSession())
    act(() => {
      root.render(<SessionView session={session} siderCollapsed={false} />)
    })
    // 走到起草位（同第一例）
    const fragments = container.querySelectorAll('[data-fragment-index]')
    const frag = fragments[1]
    if (!frag) throw new Error('第二片段宿主缺失')
    const target = frag.querySelector('strong') ?? frag
    const range = document.createRange()
    range.selectNodeContents(target)
    const sel = window.getSelection()!
    sel.removeAllRanges()
    sel.addRange(range)
    act(() => { document.dispatchEvent(new Event('selectionchange')) })
    await act(async () => { await new Promise((r) => setTimeout(r, 450)) })
    const askBtn = [...container.querySelectorAll('button')].find((b) => b.textContent?.includes('追问'))
    act(() => { (askBtn as HTMLButtonElement).click() })
    // 起草就位：右栏是 AskPane
    expect(container.textContent).toContain('就这段提问')

    // 抓 AskPane 专属 textarea（placeholder 可辨识）：第一个 textarea 是中栏
    // ChatInput 的，往那里打字会触发 sendMessage 顶穿主线，不是本例的 askAt 路径
    const textarea = container.querySelector<HTMLTextAreaElement>(
      'textarea[placeholder="针对这一段，你想问什么？"]',
    )!
    expect(textarea).toBeTruthy()
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!
      setter.call(textarea, '这段怎么理解？')
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
    })
    act(() => {
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    })
    // askAt 写 store 并流式；生产里 App 立刻把新 session 传回 SessionView——等价一次
    await rerenderWithFreshSession(session.id)

    // placeChild：右栏从起草位换成子对话位——出现子对话的顶栏（设为当前/关闭），
    // 且轨道仍承载双栏（data-track 在）
    expect(container.querySelector('[data-track]')).toBeTruthy()
    expect(container.textContent).toContain('设为当前')
    // 起草位应已让位（不再是"就这段提问"的占位提示）
    expect(container.textContent).not.toContain('针对这一段，你想问什么？')
  }, 20000)
})

// 四条规则的完整闭环（decisions/2026-11-19 §二.3/§二.5）：
// 分支卡进右栏 → 右栏再追问（嵌套，旧右栏沉中栏）→ 返回上一级 → 设为当前 → ✕关闭。
const nestedSession = (): Session => ({
  id: 's2',
  title: '嵌套',
  createdAt: 1,
  updatedAt: 1,
  rootMessageId: 'u1',
  messages: [
    { id: 'u1', role: 'user', content: '开头问', files: [], createdAt: 1, parentId: null, selectedChildId: 'a1' },
    {
      id: 'a1', role: 'assistant', createdAt: 2, model: null, prefix: true, status: 'done', parentId: 'u1',
      blocks: [{ type: 'text' as const, text: '主线一。\n\n主线二。' }],
    } as any,
    {
      id: 'q1', role: 'user', createdAt: 3, parentId: 'a1', selectedChildId: 'r1',
      content: '你在回答中写过这段内容：\n\n> 主线二。\n\n我的追问：子问一',
      files: [],
      ask: { anchorText: '主线二。', anchorMessageId: 'a1', fragmentIndex: 1 },
    },
    {
      id: 'r1', role: 'assistant', createdAt: 4, model: null, prefix: true, status: 'done', parentId: 'q1',
      blocks: [{ type: 'text' as const, text: '子答一。' }],
    } as any,
    {
      id: 'q2', role: 'user', createdAt: 5, parentId: 'r1', selectedChildId: 'r2',
      content: '你在回答中写过这段内容：\n\n> 子答一。\n\n我的追问：孙问',
      files: [],
      ask: { anchorText: '子答一。', anchorMessageId: 'r1', fragmentIndex: 0 },
    },
    {
      id: 'r2', role: 'assistant', createdAt: 6, model: null, prefix: true, status: 'done', parentId: 'q2',
      blocks: [{ type: 'text' as const, text: '孙答。' }],
    } as any,
  ],
})

describe('四条 pane 规则闭环：卡进右栏 → 嵌套下潜 → 返回 → 设为当前', () => {
  it('分支卡进右栏、嵌套追问沉栏、goBack 父子对照、promote 升中栏、✕清空右栏', async () => {
    const session = await seedStore(nestedSession())
    act(() => {
      root.render(<SessionView session={session} siderCollapsed={false} />)
    })

    // 初始：单栏主线，无轨道；主线不被追问顶穿（q1 不进中栏正文）
    expect(container.querySelector('[data-track]')).toBeNull()
    expect(container.textContent).toContain('主线一。')
    expect(container.textContent).not.toContain('子答一。')

    // §二.5 点分支卡：q1 子对话进右栏（placeChild from main）
    const card1 = container.querySelector<HTMLButtonElement>('[data-ask-card]')!
    expect(card1).toBeTruthy()
    act(() => { card1.click() })
    expect(container.querySelector('[data-track]')).toBeTruthy()
    expect(container.querySelectorAll('[data-lane]').length).toBe(2)
    expect(container.textContent).toContain('子答一。')
    expect(container.textContent).toContain('设为当前')

    // 嵌套：右栏 q1 链里再点 q2 卡 → placeChild from right：q1 沉中栏、q2 进右栏
    const right = container.querySelector('[data-right-pane]')!
    const card2 = right.querySelector<HTMLButtonElement>('[data-ask-card]')!
    expect(card2).toBeTruthy()
    act(() => { card2.click() })
    expect(container.querySelectorAll('[data-lane]').length).toBe(3)
    expect(container.textContent).toContain('孙答。')

    // ✕关闭：右栏清空，中栏保持在 q1（已下潜），lanes 末格回起草占位
    const closeBtn = [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === '✕')!
    expect(closeBtn).toBeTruthy()
    act(() => { closeBtn.click() })
    expect(container.querySelectorAll('[data-lane]').length).toBe(3)
    expect(container.textContent).not.toContain('孙答。')
    // 起草位空态（§二.4：无起草无子对话时）
    expect(container.textContent).toContain('选中一段文字')

    // 返回上一级（planGoBack）：视口左移——主线回中栏，q1 留在右栏对照
    const backBtn = [...container.querySelectorAll('button')].find((b) => b.textContent?.includes('返回'))!
    expect(backBtn).toBeTruthy()
    act(() => { backBtn.click() })
    expect(container.querySelectorAll('[data-lane]').length).toBe(2)
    expect(container.textContent).toContain('主线一。')
    expect(container.textContent).toContain('子答一。')

    // 设为当前（planPromote）：q1 升入中栏，右栏清空回起草占位
    const promoteBtn = [...container.querySelectorAll('button')].find((b) => b.textContent?.includes('设为当前'))!
    act(() => { promoteBtn.click() })
    expect(container.querySelectorAll('[data-lane]').length).toBe(3)
    expect(container.textContent).toContain('选中一段文字')
  }, 20000)
})

// 第五步（decisions/2026-11-19 §二.5）：被选过的原文片段常驻下划线 + 片段下
// 引子卡（💬 + 追问摘要 + "N 条追问 ›"）；返回父层时来源锚点高亮为"返回到这里"。
describe('片段级引子卡 + 下划线 + 返回到这里高亮（第五步）', () => {
  const fragmentAskedSession = (): Session => ({
    id: 's3',
    title: '片段引子',
    createdAt: 1,
    updatedAt: 1,
    rootMessageId: 'u1',
    messages: [
      { id: 'u1', role: 'user', content: '开头问', files: [], createdAt: 1, parentId: null, selectedChildId: 'a1' },
      {
        id: 'a1', role: 'assistant', createdAt: 2, model: null, prefix: true, status: 'done', parentId: 'u1',
        blocks: [{ type: 'text' as const, text: '第一段正文。\n\n第二段正文。\n\n第三段正文。' }],
      } as any,
      // 第二段被追过一次（fragmentIndex=1）；第三段被追过两次（fragmentIndex=2）
      {
        id: 'q1', role: 'user', createdAt: 3, parentId: 'a1', selectedChildId: 'r1',
        content: '你在回答中写过这段内容：\n\n> 第二段正文。\n\n我的追问：二段追问',
        files: [],
        ask: { anchorText: '第二段正文。', anchorMessageId: 'a1', fragmentIndex: 1 },
      },
      {
        id: 'r1', role: 'assistant', createdAt: 4, model: null, prefix: true, status: 'done', parentId: 'q1',
        blocks: [{ type: 'text' as const, text: '二段答。' }],
      } as any,
      {
        id: 'q2', role: 'user', createdAt: 5, parentId: 'a1', selectedChildId: 'r2',
        content: '三段追问一',
        files: [],
        ask: { anchorText: '第三段正文。', anchorMessageId: 'a1', fragmentIndex: 2 },
      },
      {
        id: 'r2', role: 'assistant', createdAt: 6, model: null, prefix: true, status: 'done', parentId: 'q2',
        blocks: [{ type: 'text' as const, text: '三段答一。' }],
      } as any,
      {
        id: 'q3', role: 'user', createdAt: 7, parentId: 'a1', selectedChildId: 'r3',
        content: '三段追问二',
        files: [],
        ask: { anchorText: '第三段正文。', anchorMessageId: 'a1', fragmentIndex: 2 },
      },
      {
        id: 'r3', role: 'assistant', createdAt: 8, model: null, prefix: true, status: 'done', parentId: 'q3',
        blocks: [{ type: 'text' as const, text: '三段答二。' }],
      } as any,
    ],
  })

  it('被追片段常驻下划线 + 片段下引子卡（追问数正确）', async () => {
    const session = await seedStore(fragmentAskedSession())
    act(() => {
      root.render(<SessionView session={session} siderCollapsed={false} />)
    })
    const fragments = container.querySelectorAll('[data-fragment-index]')
    expect(fragments.length).toBe(3)
    // 第二段（index 1）与第三段（index 2）被打下划线标记；第一段未追过则无
    const frag0 = fragments[0]
    const frag1 = fragments[1]
    const frag2 = fragments[2]
    if (!frag0 || !frag1 || !frag2) throw new Error('片段宿主缺失')
    // 真机反馈①修订：下划线打在内联 span 上只包命中文本（不是整块宿主）
    expect(frag0.querySelectorAll('[data-ask-referenced]').length).toBe(0)
    const ref1 = frag1.querySelector('[data-ask-referenced]')
    expect(ref1).toBeTruthy()
    expect(ref1!.textContent).toBe('第二段正文。')
    expect(frag2.querySelectorAll('[data-ask-referenced]').length).toBe(1)
    // 引子卡挂在片段宿主内（片段级），不在消息底部整列
    const card1 = frag1.querySelector('[data-ask-card]')
    expect(card1).toBeTruthy()
    expect(card1!.textContent).toContain('二段追问')
    // 真机反馈③：计数恒为 1 时不显示（"1 条追问"无信息量，且从未变化过）
    expect(card1!.textContent).not.toContain('1 条追问')
    const cards3 = frag2.querySelectorAll('[data-ask-card]')
    expect(cards3.length).toBe(2)
    expect(cards3[0]?.textContent).toContain('三段追问一')
    expect(cards3[1]?.textContent).toContain('三段追问二')
    expect(cards3[0]?.textContent).toContain('2 条追问')
  }, 20000)

  it('点片段引子卡：子对话进右栏（§二.5 与点卡同路径）', async () => {
    const session = await seedStore(fragmentAskedSession())
    act(() => {
      root.render(<SessionView session={session} siderCollapsed={false} />)
    })
    const fragments = container.querySelectorAll('[data-fragment-index]')
    const frag1b = fragments[1]
    if (!frag1b) throw new Error('第二片段宿主缺失')
    const card1 = frag1b.querySelector<HTMLButtonElement>('[data-ask-card]')!
    act(() => { card1.click() })
    // 子对话进右栏：出现右栏顶栏与子对话内容
    expect(container.textContent).toContain('设为当前')
    expect(container.textContent).toContain('二段答。')
  }, 20000)

  it('返回父层时来源锚点片段带"返回到这里"高亮', async () => {
    const session = await seedStore(fragmentAskedSession())
    act(() => {
      root.render(<SessionView session={session} siderCollapsed={false} />)
    })
    // 点卡进右栏 → promote 子对话升中栏（嵌套下潜）
    const fragments = container.querySelectorAll('[data-fragment-index]')
    const frag1c = fragments[1]
    if (!frag1c) throw new Error('第二片段宿主缺失')
    const card1 = frag1c.querySelector<HTMLButtonElement>('[data-ask-card]')!
    act(() => { card1.click() })
    const promoteBtn = [...container.querySelectorAll('button')].find((b) => b.textContent?.includes('设为当前'))!
    act(() => { promoteBtn.click() })
    // 现在在 q1 lane（嵌套），返回上一级：父层 a1 lane 里第二段带高亮
    const backBtn = [...container.querySelectorAll('button')].find((b) => b.textContent?.includes('返回上一级'))!
    act(() => { backBtn.click() })
    // "返回到这里"高亮（第三轮修订）：打在内联 span 上与下划线同位同粒度，
    // 不再是块宿主背景块——全容器至多一处，文本恰为来源锚点原文
    const highlighted = [...container.querySelectorAll('[data-ask-return]')]
    expect(highlighted.length).toBe(1)
    expect(highlighted[0]!.textContent).toBe('第二段正文。')
    expect(highlighted[0]!.hasAttribute('data-ask-referenced')).toBe(true)
  }, 20000)
})

// 第三轮改判前实证：用户高频场景是 AI 用列表作答——锚点落在列表项文本里。
// 此前 blockTextOf 只认 paragraph/heading，list 块既匹配不到锚点
// （卡沉兜底列）也打不上划线（嵌套层不传 anchor）——划线反复返工的根因。
describe('划线覆盖：锚点落在 list 项内也精确定点', () => {
  it('列表项里的锚点：划线打在 li 内、卡挂列表块下、不沉兜底列', async () => {
    const { useChatStore } = await import('../web/src/services/chat/store.js')
    const session: Session = {
      id: 's6',
      title: '列表锚点',
      createdAt: 1,
      updatedAt: 1,
      rootMessageId: 'u1',
      messages: [
        { id: 'u1', role: 'user', content: '开头问', files: [], createdAt: 1, parentId: null, selectedChildId: 'a1' },
        {
          id: 'a1', role: 'assistant', createdAt: 2, model: null, prefix: true, status: 'done', parentId: 'u1',
          blocks: [{ type: 'text' as const, text: '开头段。\n\n- 第一条目内容\n- 第二条目内容' }],
        } as any,
        {
          id: 'q1', role: 'user', createdAt: 3, parentId: 'a1', selectedChildId: 'r1',
          content: '你在回答中写过这段内容：\n\n> 第一条目\n\n我的追问：条目追问',
          files: [],
          ask: { anchorText: '第一条目', anchorMessageId: 'a1', fragmentIndex: 1 },
        },
        {
          id: 'r1', role: 'assistant', createdAt: 4, model: null, prefix: true, status: 'done', parentId: 'q1',
          blocks: [{ type: 'text' as const, text: '条目答。' }],
        } as any,
      ],
    }
    useChatStore.setState({
      ready: true, importingHistory: false,
      sessions: [{ id: session.id, title: session.title, createdAt: 1, updatedAt: 1 }],
      sessionCache: { [session.id]: session as never }, activeId: session.id, streaming: {},
    })
    act(() => {
      root.render(<SessionView session={session} siderCollapsed={false} />)
    })
    const li = [...container.querySelectorAll('li')].find((el) => el.textContent?.includes('第一条目'))
    expect(li).toBeTruthy()
    const mark = li!.querySelector('[data-ask-referenced]')
    expect(mark).toBeTruthy()
    expect(mark!.textContent).toBe('第一条目')
    // 卡挂列表所属块（不沉兜底列）
    expect(container.querySelector('[data-ask-card]')).toBeTruthy()
    expect(container.querySelector('[data-ask-fallback]')).toBeNull()
  }, 20000)
})

// 第二轮真机反馈（同日）：①② 片段级定位漂移——锚点记录只存顶层块索引，
// 下划线打在整块、卡只按存的索引挂；块文本一变（或选的是块内一小段），
// 卡就挂到别的块甚至整条消息底部。修复口径：渲染按 anchorText 在当前
// 块文本内精确匹配，卡挂命中块、下划线只包命中文本（fragmentIndex 仅作
// 存储兼容字段，不再是定位依据）。
const driftedIndexSession = (): Session => ({
  id: 's4',
  title: '索引漂移',
  createdAt: 1,
  updatedAt: 1,
  rootMessageId: 'u1',
  messages: [
    { id: 'u1', role: 'user', content: '开头问', files: [], createdAt: 1, parentId: null, selectedChildId: 'a1' },
    {
      id: 'a1', role: 'assistant', createdAt: 2, model: null, prefix: true, status: 'done', parentId: 'u1',
      blocks: [{ type: 'text' as const, text: '开头段。\n\n中间第二段正文。\n\n结尾第三段。' }],
    } as any,
    {
      // fragmentIndex 存了 2，但 anchorText 实际出现在块 1——渲染必须按文本纠偏
      id: 'q1', role: 'user', createdAt: 3, parentId: 'a1', selectedChildId: 'r1',
      content: '你在回答中写过这段内容：\n\n> 第二段正文\n\n我的追问：二段追问',
      files: [],
      ask: { anchorText: '第二段正文', anchorMessageId: 'a1', fragmentIndex: 2 },
    },
    {
      id: 'r1', role: 'assistant', createdAt: 4, model: null, prefix: true, status: 'done', parentId: 'q1',
      blocks: [{ type: 'text' as const, text: '二段答。' }],
    } as any,
  ],
})

describe('第二轮真机反馈：片段定位按 anchorText 精确匹配（①②）', () => {
  it('存的 fragmentIndex 漂移时：卡挂在 anchorText 实际所在的块，不随错索引走', async () => {
    const session = await seedStore(driftedIndexSession())
    act(() => {
      root.render(<SessionView session={session} siderCollapsed={false} />)
    })
    const fragments = container.querySelectorAll('[data-fragment-index]')
    expect(fragments.length).toBe(3)
    // 卡应挂块 1（anchorText 所在），不是存的 index 2，也不沉到整条消息底部
    expect(fragments[1]!.querySelector('[data-ask-card]')).toBeTruthy()
    expect(fragments[2]!.querySelector('[data-ask-card]')).toBeNull()
    // 下划线只包命中的那一小撮文本，不是整段（用户选了"第二段正文"四个字）
    const mark = fragments[1]!.querySelector('[data-ask-referenced]')
    expect(mark).toBeTruthy()
    expect(mark!.textContent).toBe('第二段正文')
  }, 20000)
})

// ④ 追问挂载点 q1 与主线下一问 u2 共享 parentId+role——按角色分键后仍同组，
// u2 上被凑出 <2/2>。ask 挂载是分支入口（靠卡片陈列），不是主线问题的
// "另一个版本"，必须完全移出版本分组。
const mainlineWithAskSibling = (): Session => ({
  id: 's5',
  title: '主线多问带追问',
  createdAt: 1,
  updatedAt: 1,
  rootMessageId: 'u1',
  messages: [
    { id: 'u1', role: 'user', content: '第一问', files: [], createdAt: 1, parentId: null, selectedChildId: 'a1' },
    {
      id: 'a1', role: 'assistant', createdAt: 2, model: null, prefix: true, status: 'done', parentId: 'u1', selectedChildId: 'u2',
      blocks: [{ type: 'text' as const, text: '第一答。' }],
    } as any,
    // 追问挂载：parentId=a1 的 user（分支入口，不是主线第二问的"版本"）
    {
      id: 'q1', role: 'user', createdAt: 3, parentId: 'a1', selectedChildId: 'r1',
      content: '你在回答中写过这段内容：\n\n> 第一答。\n\n我的追问：追问一',
      files: [],
      ask: { anchorText: '第一答。', anchorMessageId: 'a1', fragmentIndex: 0 },
    },
    {
      id: 'r1', role: 'assistant', createdAt: 4, model: null, prefix: true, status: 'done', parentId: 'q1',
      blocks: [{ type: 'text' as const, text: '追问答。' }],
    } as any,
    // 主线继续：a1.selectedChildId=u2——u2 与 q1 同 parentId=a1 同 role=user
    { id: 'u2', role: 'user', content: '第二问', files: [], createdAt: 5, parentId: 'a1', selectedChildId: 'a2' },
    {
      id: 'a2', role: 'assistant', createdAt: 6, model: null, prefix: true, status: 'done', parentId: 'u2',
      blocks: [{ type: 'text' as const, text: '第二答。' }],
    } as any,
  ],
})

describe('第二轮真机反馈 ④：ask 挂载不进版本分组', () => {
  it('主线第二问不与追问挂载凑成 <2/2>', async () => {
    const session = await seedStore(mainlineWithAskSibling())
    // a1.selectedChildId 指向 u2（主线继续），追问 q1 挂在 a1 下同 parentId
    act(() => {
      root.render(<SessionView session={session} siderCollapsed={false} />)
    })
    expect(container.textContent).toContain('第二问')
    expect(container.textContent).not.toMatch(/\d\s*\/\s*2/)
  }, 20000)
})

// 真机反馈 2026-11-22：桌面端「返回上一级」曾渲染成 lane 内的独立浮动条
// （.laneHeader：sticky 贴在滚动区顶部、height:0 悬在正文之上），于是它在标题行
// 下方另占一块视觉空间。手机端早已改到标题行内（MobileHeader 的 start 槽位），
// 桌面与手机在这一点上应当同构：同一条标题行，不另起一行。
describe('桌面端「返回上一级」在标题行内', () => {
  it('进嵌套层后按钮落在标题行容器里，且 lane 内没有独立顶栏', async () => {
    const session = await seedStore(nestedSession())
    act(() => {
      root.render(<SessionView session={session} siderCollapsed={false} />)
    })
    // 进嵌套层：卡进右栏 → 设为当前（q1 升入中栏，此时中栏离主线根）
    const card = container.querySelector<HTMLButtonElement>('[data-ask-card]')!
    expect(card).toBeTruthy()
    act(() => { card.click() })
    const promoteBtn = [...container.querySelectorAll('button')].find((b) => b.textContent?.includes('设为当前'))!
    expect(promoteBtn).toBeTruthy()
    act(() => { promoteBtn.click() })

    // 效果：标题行同时含标题与返回按钮（同一行）
    const header = container.querySelector('[data-session-header]')
    expect(header).toBeTruthy()
    expect(header!.textContent).toContain('嵌套')
    const inHeader = [...header!.querySelectorAll('button')].filter((b) =>
      b.textContent?.includes('返回上一级'),
    )
    expect(inHeader.length).toBe(1)

    // 不变量：全页只有这一个返回按钮，且它不在任何 lane 内、lane 内也没有顶栏条
    const all = [...container.querySelectorAll('button')].filter((b) =>
      b.textContent?.includes('返回上一级'),
    )
    expect(all.length).toBe(1)
    expect(all[0]!.closest('[data-lane]')).toBeNull()
    expect(container.querySelector('[data-center-header]')).toBeNull()
  }, 20000)

  it('主线根层不渲染返回按钮（无父级可回）', async () => {
    const session = await seedStore(nestedSession())
    act(() => {
      root.render(<SessionView session={session} siderCollapsed={false} />)
    })
    expect(container.textContent).not.toContain('返回上一级')
  }, 20000)
})

// 真机反馈 2026-11-22：右栏比中栏低了一条工具栏的高度。
// 原因：右栏 lane 里带着自己的 44px 顶栏（[data-right-header]：「子对话 / 设为当前 /
// ✕」），而中栏没有对应结构，两栏内容起点因此差 44px。控件改到顶部标题行后，
// 右栏 lane 的首个子元素直接是消息列表，两栏内容自然齐平。
describe('右栏控件在标题行内（两栏内容顶对齐）', () => {
  it('打开子对话后，控件进标题行且右栏 lane 内没有独立顶栏', async () => {
    const session = await seedStore(nestedSession())
    act(() => {
      root.render(<SessionView session={session} siderCollapsed={false} />)
    })
    // 点分支卡：子对话进右栏
    const card = container.querySelector<HTMLButtonElement>('[data-ask-card]')!
    expect(card).toBeTruthy()
    act(() => { card.click() })
    expect(container.textContent).toContain('设为当前')

    // 效果：控件都落在标题行容器内
    const header = container.querySelector('[data-session-header]')
    expect(header).toBeTruthy()
    expect(header!.textContent).toContain('子问一')
    const promote = [...header!.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('设为当前'),
    )
    expect(promote).toBeTruthy()
    expect(header!.querySelector('button[aria-label="关闭"]')).toBeTruthy()

    // 不变量：lane 内不再有独立顶栏；右栏包装层只剩消息列表一个子元素
    expect(container.querySelector('[data-right-header]')).toBeNull()
    const rightLane = [...container.querySelectorAll('[data-lane]')][1]
    const rightPane = rightLane!.firstElementChild!
    expect(rightPane.hasAttribute('data-right-pane')).toBe(true)
    expect(rightPane.children.length).toBe(1)
  }, 20000)

  it('✕关闭后标题行不再出现子对话控件（右栏空态）', async () => {
    const session = await seedStore(nestedSession())
    act(() => {
      root.render(<SessionView session={session} siderCollapsed={false} />)
    })
    const card = container.querySelector<HTMLButtonElement>('[data-ask-card]')!
    act(() => { card.click() })
    const closeBtn = [...container.querySelectorAll('button')].find(
      (b) => b.getAttribute('aria-label') === '关闭',
    )!
    expect(closeBtn).toBeTruthy()
    act(() => { closeBtn.click() })
    expect(container.textContent).not.toContain('设为当前')
  }, 20000)
})

// 真机反馈 2026-11-22：右栏最上面只显示固定的"子对话"，没有这栏自己的标题。
// 口径与中栏（及手机端标题行）一致：该层根追问的 ask.title（模型生成的短标题）
// 优先，未生成时回退提问本体。
describe('右栏标题显示该层自己的标题', () => {
  it('无 ask.title 时回退提问本体，不再显示固定文案「子对话」', async () => {
    const session = await seedStore(nestedSession())
    act(() => {
      root.render(<SessionView session={session} siderCollapsed={false} />)
    })
    const card = container.querySelector<HTMLButtonElement>('[data-ask-card]')!
    act(() => { card.click() })

    const controls = container.querySelector('[data-right-controls]')
    expect(controls).toBeTruthy()
    // nestedSession 的 q1 提问本体是「子问一」，没有 ask.title
    expect(controls!.textContent).toContain('子问一')
    expect(controls!.textContent).not.toContain('子对话')
  }, 20000)

  it('有 ask.title 时优先用模型生成的短标题', async () => {
    const base = nestedSession()
    const session = await seedStore({
      ...base,
      messages: base.messages.map((m) =>
        m.id === 'q1' && m.role === 'user'
          ? { ...m, ask: { ...m.ask!, title: '追问小标题' } }
          : m,
      ),
    })
    act(() => {
      root.render(<SessionView session={session} siderCollapsed={false} />)
    })
    const card = container.querySelector<HTMLButtonElement>('[data-ask-card]')!
    act(() => { card.click() })

    const controls = container.querySelector('[data-right-controls]')
    expect(controls!.textContent).toContain('追问小标题')
    expect(controls!.textContent).not.toContain('子问一')
  }, 20000)
})

// 追问树导航（decisions/2026-11-25-ask-tree-navigator.md）：追问一多，沿引子卡
// 逐层进出找不回之前的分支。「返回上一级」旁边加一个「追问树」入口，摊开整棵树、
// 标出当前位置，点任一节点直接跳过去（planJumpTo：目标进中栏）。
describe('追问树入口与跳转（桌面端）', () => {
  const treeButton = () =>
    [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === '追问树')
  const treeRow = (id: string) =>
    document.querySelector<HTMLElement>(`[data-ask-tree-row="${id}"]`)

  it('有追问时标题行出现「追问树」入口', async () => {
    const session = await seedStore(nestedSession())
    act(() => {
      root.render(<SessionView session={session} siderCollapsed={false} />)
    })
    const header = container.querySelector('[data-session-header]')!
    expect([...header.querySelectorAll('button')].some((b) => b.textContent?.trim() === '追问树')).toBe(
      true,
    )
  }, 20000)

  it('无追问的会话不渲染入口（主线只有问答，没有树可看）', async () => {
    const session = await seedStore(baseSession())
    act(() => {
      root.render(<SessionView session={session} siderCollapsed={false} />)
    })
    expect(treeButton()).toBeUndefined()
  }, 20000)

  it('点入口打开面板：列出整棵树并标出当前位置', async () => {
    const session = await seedStore(nestedSession())
    act(() => {
      root.render(<SessionView session={session} siderCollapsed={false} />)
    })
    act(() => {
      treeButton()!.click()
    })
    expect(document.querySelector('[data-ask-tree-panel]')).toBeTruthy()
    // nestedSession 的树：u1 → q1 → q2（q2 是 q1 回答上的再追问）。
    // 默认只展开到当前位置（u1），故 q1 可见、q2 折叠在 q1 之下。
    expect(treeRow('u1')).toBeTruthy()
    expect(treeRow('q1')).toBeTruthy()
    expect(treeRow('q2')).toBeFalsy()
    // 当前位置仍在主线根
    expect(treeRow('u1')!.getAttribute('aria-current')).toBe('true')
  }, 20000)

  it('点树里任一追问：面板关闭且中栏直接跳过去（不必逐级进出）', async () => {
    const session = await seedStore(nestedSession())
    act(() => {
      root.render(<SessionView session={session} siderCollapsed={false} />)
    })
    expect(container.textContent).toContain('主线一。')
    act(() => {
      treeButton()!.click()
    })
    act(() => {
      treeRow('q1')!.click()
    })
    // 面板关闭
    expect(document.querySelector('[data-ask-tree-panel]')).toBeNull()
    // 中栏已是 q1 那一层：轨道铺开（父层 + 目标 + 起草占位，computeTrack 恒补末格），
    // 正文是 q1 的回答
    expect(container.textContent).toContain('子答一。')
    expect(container.querySelectorAll('[data-lane]').length).toBe(3)
  }, 20000)

  it('跳到深层节点：祖先链完整铺开，可直接落在 q2 那层', async () => {
    const session = await seedStore(nestedSession())
    act(() => {
      root.render(<SessionView session={session} siderCollapsed={false} />)
    })
    act(() => {
      treeButton()!.click()
    })
    // 先展开 q1 才看得到 q2（默认只展开到当前位置）
    act(() => {
      ;(treeRow('q1')!.querySelector('[data-ask-tree-toggle]') as HTMLElement).click()
    })
    act(() => {
      treeRow('q2')!.click()
    })
    // 一次跳到第二层：轨道为 u1 → q1 → q2 + 起草占位
    expect(container.textContent).toContain('孙答。')
    expect(container.querySelectorAll('[data-lane]').length).toBe(4)
  }, 20000)

  it('面板打开时返回键只关面板，不退层', async () => {
    const session = await seedStore(nestedSession())
    act(() => {
      root.render(<SessionView session={session} siderCollapsed={false} />)
    })
    // 先下潜一层：卡进右栏 → 设为当前（中栏 = q1）
    act(() => {
      container.querySelector<HTMLButtonElement>('[data-ask-card]')!.click()
    })
    act(() => {
      ;[...container.querySelectorAll('button')]
        .find((b) => b.textContent?.includes('设为当前'))!
        .click()
    })
    expect(container.querySelectorAll('[data-lane]').length).toBe(3)

    act(() => {
      treeButton()!.click()
    })
    expect(document.querySelector('[data-ask-tree-panel]')).toBeTruthy()

    const event = new Event('vite-back', { cancelable: true })
    act(() => {
      document.dispatchEvent(event)
    })
    // 事件被消费（壳不退应用），但层没退——只收了面板
    expect(event.defaultPrevented).toBe(true)
    expect(document.querySelector('[data-ask-tree-panel]')).toBeNull()
    expect(container.querySelectorAll('[data-lane]').length).toBe(3)
  }, 20000)
})

// 用户 2026-11-25 报的网页版 bug：右栏开着子对话时，在中栏选一段文字追问，
// 右栏不让位、挡住起草框，追问根本没法输入。
// 规格 §二.3 planAsk 中栏选文「两栏不动，右栏切起草态」——状态不动（rightNodeId
// 保留），右栏的视觉形态切换为起草位；取消起草后原子对话回位。
// 断线点：computeTrack 只看 pane.rightNodeId，右栏非空就铺子对话格，
// relation==='draft' 分支进不去，AskPane 无处渲染。
describe('右栏开着时中栏选文追问：右栏让位给起草位', () => {
  const selectInMainPane = async () => {
    const mainFrag = [...container.querySelectorAll('[data-fragment-index]')].find(
      (f) => !f.closest('[data-right-pane]'),
    )
    if (!mainFrag) throw new Error('中栏片段宿主缺失')
    const range = document.createRange()
    range.selectNodeContents(mainFrag)
    const sel = window.getSelection()!
    sel.removeAllRanges()
    sel.addRange(range)
    act(() => { document.dispatchEvent(new Event('selectionchange')) })
    // 操作条 350ms 防抖（拖选中途不闪遮罩）
    await act(async () => { await new Promise((r) => setTimeout(r, 450)) })
    // 精确匹配操作条按钮——标题行的「追问树」入口也含「追问」二字，包含匹配会误点
    const askBtn = [...container.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === '追问',
    )
    if (!askBtn) throw new Error('追问操作条未出现')
    act(() => { (askBtn as HTMLButtonElement).click() })
  }

  it('起草位在右栏出现（不被旧子对话挡住），取消后原子对话回位', async () => {
    const session = await seedStore(nestedSession())
    act(() => {
      root.render(<SessionView session={session} siderCollapsed={false} />)
    })
    // 点卡进右栏：q1 子对话占右栏，中栏仍是主线正文
    act(() => {
      container.querySelector<HTMLButtonElement>('[data-ask-card]')!.click()
    })
    expect(container.querySelector('[data-right-pane]')).toBeTruthy()
    expect(container.textContent).toContain('子答一。')

    await selectInMainPane()

    // 效果：起草位可见可输入
    expect(container.textContent).toContain('就这段提问')
    expect(
      container.querySelector('textarea[placeholder="针对这一段，你想问什么？"]'),
    ).toBeTruthy()
    // 不变量：旧子对话不再占着右栏（否则它会盖在起草框上）
    expect(container.querySelector('[data-right-pane]')).toBeNull()
    expect(container.textContent).not.toContain('子答一。')

    // 取消起草：右栏的原子对话回位（pane.rightNodeId 全程未动）
    const cancel = [...container.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === '取消',
    )!
    act(() => { cancel.click() })
    expect(container.querySelector('[data-right-pane]')).toBeTruthy()
    expect(container.textContent).toContain('子答一。')
    expect(container.textContent).not.toContain('就这段提问')
  }, 20000)

  // 起草期间右栏的子对话已被起草位顶掉，它此刻不在眼前——标题行不能还留着
  // 指向它的「设为当前 / ✕」：点了会把一块看不见的对话升进中栏，用户无从理解。
  it('起草期间标题行不出现指向隐藏子对话的「设为当前 / ✕」', async () => {
    const session = await seedStore(nestedSession())
    act(() => {
      root.render(<SessionView session={session} siderCollapsed={false} />)
    })
    act(() => {
      container.querySelector<HTMLButtonElement>('[data-ask-card]')!.click()
    })
    // 进右栏时控件在
    expect(container.querySelector('[data-right-controls]')).toBeTruthy()

    await selectInMainPane()

    // 起草中：控件随右栏子对话一起让位
    expect(container.querySelector('[data-right-controls]')).toBeNull()
    expect(
      [...container.querySelectorAll('button')].some((b) => b.textContent?.includes('设为当前')),
    ).toBe(false)

    // 取消起草：控件随子对话一起回位
    const cancel = [...container.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === '取消',
    )!
    act(() => { cancel.click() })
    expect(container.querySelector('[data-right-controls]')).toBeTruthy()
  }, 20000)

  it('从该起草位提交：新子对话进右栏，旧子对话沉入中栏（连续下潜不丢）', async () => {
    const session = await seedStore(nestedSession())
    act(() => {
      root.render(<SessionView session={session} siderCollapsed={false} />)
    })
    act(() => {
      container.querySelector<HTMLButtonElement>('[data-ask-card]')!.click()
    })
    await selectInMainPane()

    const textarea = container.querySelector<HTMLTextAreaElement>(
      'textarea[placeholder="针对这一段，你想问什么？"]',
    )!
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        'value',
      )!.set!
      setter.call(textarea, '中栏选文的追问')
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
    })
    act(() => {
      textarea.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
      )
    })
    await rerenderWithFreshSession(session.id)

    // 新追问落右栏，起草位让出
    expect(container.textContent).not.toContain('就这段提问')
    expect(container.querySelector('[data-right-pane]')).toBeTruthy()
    // 不变量：旧子对话没有被删除，只是退回它在父层的引子卡（planPlaceChild
    // 'main'：中栏不动、子对话进右栏），随时可再点开
    expect(container.textContent).not.toContain('子答一。')
    expect(container.querySelectorAll('[data-ask-card]').length).toBeGreaterThanOrEqual(1)
  }, 20000)
})

// 用户 2026-11-25 报的网页版 bug：右栏输入时，中栏输入框同步显示同样内容。
// 双栏下同一会话同时挂着两个 ChatInput（中栏 lane 一个、右栏一个），草稿若只按
// 会话分键，两个受控 textarea 读的是同一份草稿——敲一边另一边跟着变。
describe('双栏输入互不串扰：草稿按 lane 分键', () => {
  const typeIn = (textarea: HTMLTextAreaElement, value: string) => {
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        'value',
      )!.set!
      setter.call(textarea, value)
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }

  it('在右栏输入不改变中栏输入框内容，反之亦然', async () => {
    const session = await seedStore(nestedSession())
    act(() => {
      root.render(<SessionView session={session} siderCollapsed={false} />)
    })
    // 点卡进右栏：此刻 DOM 里有中栏与右栏两个 ChatInput
    act(() => {
      container.querySelector<HTMLButtonElement>('[data-ask-card]')!.click()
    })
    const rightPane = container.querySelector('[data-right-pane]')!
    expect(rightPane).toBeTruthy()

    const mainInput = [...container.querySelectorAll('textarea')].find(
      (t) => !t.closest('[data-right-pane]'),
    )!
    const rightInput = rightPane.querySelector('textarea')!
    expect(mainInput).toBeTruthy()
    expect(rightInput).toBeTruthy()

    // 在右栏打字
    typeIn(rightInput, '右栏写的话')
    expect(rightInput.value).toBe('右栏写的话')
    // 效果：右栏有内容
    expect(rightInput.value).toBe('右栏写的话')
    // 不变量：中栏仍然是空的——这是用户报的那个 bug
    expect(mainInput.value).toBe('')

    // 反向：中栏打字也不影响右栏
    typeIn(mainInput, '中栏写的话')
    expect(mainInput.value).toBe('中栏写的话')
    expect(rightInput.value).toBe('右栏写的话')
  }, 20000)

  it('两个输入框各有独立草稿：切走再切回都还在', async () => {
    const session = await seedStore(nestedSession())
    act(() => {
      root.render(<SessionView session={session} siderCollapsed={false} />)
    })
    act(() => {
      container.querySelector<HTMLButtonElement>('[data-ask-card]')!.click()
    })
    const rightPane = container.querySelector('[data-right-pane]')!
    typeIn([...container.querySelectorAll('textarea')].find((t) => !t.closest('[data-right-pane]'))!, '主线草稿')
    typeIn(rightPane.querySelector('textarea')!, '右栏草稿')

    // 关掉右栏再点回来：右栏草稿仍在，主线草稿不受影响
    act(() => {
      ;[...container.querySelectorAll('button')]
        .find((b) => b.getAttribute('aria-label') === '关闭')!
        .click()
    })
    act(() => {
      container.querySelector<HTMLButtonElement>('[data-ask-card]')!.click()
    })
    const rightAgain = container.querySelector('[data-right-pane]')!
    expect(rightAgain.querySelector('textarea')!.value).toBe('右栏草稿')
    expect(
      [...container.querySelectorAll('textarea')].find((t) => !t.closest('[data-right-pane]'))!.value,
    ).toBe('主线草稿')
  }, 20000)
})
