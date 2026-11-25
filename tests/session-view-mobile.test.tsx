// @vitest-environment jsdom
// SessionView 手机端接线（decisions/2026-11-19 §三）：lane 轨道同一抽象，
// 视口只框一格（LANES_IN_VIEW=1）。选中追问用 AskSheet 底部弹层替代起草位，
// 提交即导航——新 lane 生成 + 视口钉末格（整屏下潜）。
// 本文件独立存在的原因：web/src/app/viewport.ts 的 matchMedia 查询对象在
// 模块顶层求值（import 时即捕获），用例内重定义 matchMedia 无效——
// 移动端断点只能由文件级 hoisted 桩在 import 前钉死。
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Session } from '../web/src/services/chat/types.js'

// 'not all and (min-width: 768px)'：窄屏下（min-width:768 不命中）matches=true → 移动端
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
      matches: true, // 窄屏：'not all and (min-width: 768px)' 命中 → useIsMobile() === true
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
  rootMessageId: 'u1',
  messages: [
    { id: 'u1', role: 'user', content: '开头问', files: [], createdAt: 1, parentId: null, selectedChildId: 'a1' },
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
const rerenderWithFreshSession = async (sessionId: string) => {
  const { useChatStore } = await import('../web/src/services/chat/store.js')
  const fresh = useChatStore.getState().sessionCache[sessionId] as Session
  act(() => {
    root.render(<SessionView session={fresh} streaming={false} siderCollapsed={false} />)
  })
}

// 已有追问分支的 fixture：主线两问两答，第二段被追过一次（与 pane 测试同形态）
const askedSession = (): Session => ({
  id: 's2',
  title: '追问分支',
  createdAt: 1,
  updatedAt: 1,
  rootMessageId: 'u1',
  messages: [
    { id: 'u1', role: 'user', content: '开头问', files: [], createdAt: 1, parentId: null, selectedChildId: 'a1' },
    {
      id: 'a1',
      role: 'assistant',
      createdAt: 2,
      model: null,
      prefix: true,
      status: 'done',
      parentId: 'u1',
      blocks: [{ type: 'text' as const, text: '第一段正文。\n\n第二段正文。' }],
    } as any,
    {
      id: 'q1',
      role: 'user',
      createdAt: 3,
      parentId: 'a1',
      selectedChildId: 'r1',
      content: '你在回答中写过这段内容：\n\n> 第二段正文。\n\n我的追问：二段追问',
      files: [],
      ask: { anchorText: '第二段正文。', anchorMessageId: 'a1', fragmentIndex: 1 },
    } as any,
    {
      id: 'r1',
      role: 'assistant',
      createdAt: 4,
      model: null,
      prefix: true,
      status: 'done',
      parentId: 'q1',
      blocks: [{ type: 'text' as const, text: '二段答。' }],
    } as any,
  ],
})

describe('手机端点引子卡 + 追问消息呈现（真机反馈修复）', () => {
  it('点片段引子卡：视口整屏下潜到子对话（③ 点卡无变化；§三 单格轨道）', async () => {
    const session = await seedStore(askedSession())
    act(() => {
      root.render(<SessionView session={session} streaming={false} siderCollapsed={false} />)
    })
    // 初始：恒走 TrackStage（根态单格），无下潜
    expect(container.querySelectorAll('[data-lane]').length).toBe(1)
    const card = container.querySelector<HTMLButtonElement>('[data-ask-card]')!
    expect(card).toBeTruthy()
    act(() => { card.click() })
    // 点卡即导航（与提交即导航同语义）：轨道增格、视口钉到子对话那格
    expect(container.querySelectorAll('[data-lane]').length).toBe(2)
    // 「返回上一级」在手机端用图标（向左箭头）——通用返回语义，把标题宽度让出来。
    // 断言改按无障碍名称查，图标按钮没有可见文字。
    expect(
      [...container.querySelectorAll('button')].some(
        (b) => b.getAttribute('aria-label') === '返回上一级',
      ),
    ).toBe(true)
    // ⑦ 新 lane 里追问的用户消息不是主线"同级版本"——不应出现 <2/2> 版本切换器；
    // BranchSwitcher 仅在真·同级分支（ids.length > 1）时渲染
    expect(container.textContent).not.toMatch(/1\s*\/\s*2/)
  }, 20000)

  it('追问的用户消息不再整段原样粘贴系统前缀（④）——只显示我的问题', async () => {
    const session = await seedStore(askedSession())
    act(() => {
      root.render(<SessionView session={session} streaming={false} siderCollapsed={false} />)
    })
    const card = container.querySelector<HTMLButtonElement>('[data-ask-card]')!
    act(() => { card.click() })
    // lane 内用户泡只呈现问题本体（④ 修复后 UserMessage 按 message.ask 剥出）：
    // 自动拼装的"{引用} + 我的追问："前缀不裸露在文字泡里
    const userBubbles = container.querySelectorAll('[class*="bubble"]')
    const texts = [...userBubbles].map((b) => b.textContent?.trim())
    expect(texts.some((txt) => txt?.includes('我的追问：'))).toBe(false)
    expect(texts.some((txt) => txt?.includes('你在回答中写过'))).toBe(false)
    expect(texts.some((txt) => txt === '二段追问')).toBe(true)
  }, 20000)
})

describe('手机端选中追问 → AskSheet 底部弹层 + 提交即导航（第四条退化）', () => {
  it('手机端选中后点追问：AskSheet 出现且无浮动 Popover，提交后整屏下潜到子对话', async () => {
    const session = await seedStore(baseSession())
    act(() => {
      root.render(<SessionView session={session} streaming={false} siderCollapsed={false} />)
    })
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
    // 操作条有 350ms 停顿防抖（防拖选中途遮罩盖手柄）
    await act(async () => { await new Promise((r) => setTimeout(r, 450)) })
    const askBtn = [...container.querySelectorAll('button')].find((b) => b.textContent?.includes('追问'))
    act(() => { (askBtn as HTMLButtonElement).click() })

    // 手机端起草走 AskSheet 底部弹层（data-ask-sheet），不再用浮动 Popover（data-ask-panel）
    expect(container.querySelector('[data-ask-sheet]')).toBeTruthy()
    expect(container.querySelector('[data-ask-panel]')).toBeNull()
    expect(container.textContent).toContain('就这段提问')

    // 提交即导航：AskSheet 内输入并 Enter——不点提问按钮（同 placeChild 例的按钮 disabled 竞态）
    const textarea = container.querySelector<HTMLTextAreaElement>('[data-ask-sheet] textarea')!
    expect(textarea).toBeTruthy()
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!
      setter.call(textarea, '这段怎么理解？')
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
    })
    act(() => {
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    })
    await rerenderWithFreshSession(session.id)

    // 整屏下潜（§三.3）：AskSheet 关闭，新 lane（子对话）占据视口——
    // data-track 在（单格轨道），对话已切到追问那一层，顶栏出现返回箭头
    expect(container.querySelector('[data-ask-sheet]')).toBeNull()
    expect(container.querySelector('[data-track]')).toBeTruthy()
    // 追问的用户提问进入当前视口；主线父对话保留在屏外轨道（lane 不销毁）
    expect(container.textContent).toContain('这段怎么理解？')
    expect(container.querySelectorAll('[data-lane]').length).toBe(2)
  }, 20000)
})

// 返回键分层（decisions/2026-11-19 §三.1）：系统返回键先退层、再退应用。
// 实现契约：壳按返回键时向前端发 'vite-back' 自定义事件——有追问层开着时
// SessionView 接住、执行 planGoBack 退一层（事件被消费）；在主线根层时
// 不接、壳走系统默认动作（退应用）。vue/capacitor 生态有同名插件惯例沿用契约。
describe('系统返回键分层：先退层、再退应用（vite-back 事件契约）', () => {
  it('下潜后按返回键退到父层，主线根层按返回不拦截', async () => {
    const session = await seedStore(baseSession())
    act(() => {
      root.render(<SessionView session={session} streaming={false} siderCollapsed={false} />)
    })

    // 主线根层：vite-back 不被 preventDefault（壳据此走系统默认）
    let event = new Event('vite-back', { cancelable: true })
    act(() => { document.dispatchEvent(event) })
    expect(event.defaultPrevented).toBe(false)

    // 走一遍下潜：选中 → 追问 → AskSheet 提交 → lane 2 层
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
    const textarea = container.querySelector<HTMLTextAreaElement>('[data-ask-sheet] textarea')!
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!
      setter.call(textarea, '这段怎么理解？')
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
    })
    act(() => {
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    })
    await rerenderWithFreshSession(session.id)
    expect(container.querySelectorAll('[data-lane]').length).toBe(2)

    // 第 2 层按返回键：事件被消费（preventDefault），视口回主线根、lanes 1 层，
    // 追问内容离开视口但 lane 不销毁
    event = new Event('vite-back', { cancelable: true })
    act(() => { document.dispatchEvent(event) })
    expect(event.defaultPrevented).toBe(true)
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
    // 退回主线根：恒走 TrackStage（⑤ 修复后根态也在轨道上），lanes 回 1 格、
    // 追问摘要以片段引子卡形式留在父层是正确的（§二.5）
    expect(container.querySelector('[data-track]')).toBeTruthy()
    expect(container.querySelectorAll('[data-lane]').length).toBe(1)

    // 退到主线后再按返回键：不再拦截，壳走系统默认
    event = new Event('vite-back', { cancelable: true })
    act(() => { document.dispatchEvent(event) })
    expect(event.defaultPrevented).toBe(false)
  }, 20000)
})

// 第二轮真机反馈 ③：追问层（lane）里的 ChatInput 曾恒挂主线可见链尾
// （sendMessage 只用 getVisibleMessages(session).at(-1)），在追问层直接
// 发送的消息全部落到父级末尾、追问层里看不见。
describe('第二轮真机反馈 ③：lane 内发送挂在该层链尾', () => {
  it('追问层里发送的消息：parentId 是追问层可见链尾（不是主线尾）', async () => {
    const session = await seedStore(askedSession())
    act(() => {
      root.render(<SessionView session={session} streaming={false} siderCollapsed={false} />)
    })
    // 点卡下潜到追问层（lanes=2，末格在视口）
    const card = container.querySelector<HTMLButtonElement>('[data-ask-card]')!
    expect(card).toBeTruthy()
    act(() => { card.click() })
    expect(container.querySelectorAll('[data-lane]').length).toBe(2)

    // 视口末格（追问层）的 ChatInput 里输入并发送——取 DOM 里最后一个 textarea
    // （lane 按 root→当前顺序铺，当前层渲染最后）
    const textareas = container.querySelectorAll('textarea')
    const input = textareas[textareas.length - 1]!
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!
      setter.call(input, '在追问层里接着问')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    })

    // 挂载正确口径：新消息的 parentId = 追问层可见链尾 r1；旧线恒挂主线尾 a1
    const { useChatStore } = await import('../web/src/services/chat/store.js')
    const fresh = useChatStore.getState().sessionCache[session.id] as Session
    const sent = fresh.messages.find((m) => m.role === 'user' && m.content === '在追问层里接着问')
    expect(sent).toBeTruthy()
    expect(sent!.parentId).toBe('r1')
  }, 20000)
})

// 追问树导航（decisions/2026-11-25-ask-tree-navigator.md §四）：手机端入口用图标
// （文字会挤占标题宽度），点开是同一套面板；点节点=整屏下潜到那一层。
describe('手机端追问树（图标入口 + 整屏下潜）', () => {
  const headerButton = (label: string) =>
    [...container.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === label)
  const treeRow = (id: string) =>
    document.querySelector<HTMLElement>(`[data-ask-tree-row="${id}"]`)

  it('有追问时标题行出现「查看追问树」图标入口', async () => {
    const session = await seedStore(askedSession())
    act(() => {
      root.render(<SessionView session={session} streaming={false} siderCollapsed={false} />)
    })
    expect(headerButton('查看追问树')).toBeTruthy()
  }, 20000)

  it('主线根层不显示返回图标（无父级可回）', async () => {
    const session = await seedStore(askedSession())
    act(() => {
      root.render(<SessionView session={session} streaming={false} siderCollapsed={false} />)
    })
    // 有追问 → 追问树图标在；但没下潜 → 返回图标不在
    expect(headerButton('查看追问树')).toBeTruthy()
    expect(headerButton('返回上一级')).toBeUndefined()
  }, 20000)

  it('下潜一层后返回图标出现，点它退回父层', async () => {
    const session = await seedStore(askedSession())
    act(() => {
      root.render(<SessionView session={session} streaming={false} siderCollapsed={false} />)
    })
    act(() => {
      container.querySelector<HTMLButtonElement>('[data-ask-card]')!.click()
    })
    expect(container.querySelectorAll('[data-lane]').length).toBe(2)
    const back = headerButton('返回上一级')
    expect(back).toBeTruthy()
    act(() => {
      back!.click()
    })
    expect(container.querySelectorAll('[data-lane]').length).toBe(1)
  }, 20000)

  it('点图标入口打开面板，点另一层追问即整屏下潜过去', async () => {
    const session = await seedStore(askedSession())
    act(() => {
      root.render(<SessionView session={session} streaming={false} siderCollapsed={false} />)
    })
    // 先下潜到 q1，再打开树——当前位置应在 q1，且主线根仍在列表里
    act(() => {
      container.querySelector<HTMLButtonElement>('[data-ask-card]')!.click()
    })
    act(() => {
      headerButton('查看追问树')!.click()
    })
    expect(document.querySelector('[data-ask-tree-panel]')).toBeTruthy()
    expect(treeRow('q1')!.getAttribute('aria-current')).toBe('true')

    // 跳回主线根：面板关闭、lane 回到 1 格
    act(() => {
      treeRow('u1')!.click()
    })
    expect(document.querySelector('[data-ask-tree-panel]')).toBeNull()
    expect(container.querySelectorAll('[data-lane]').length).toBe(1)
  }, 20000)

  it('面板打开时返回键只收面板，整屏下潜的层不动', async () => {
    const session = await seedStore(askedSession())
    act(() => {
      root.render(<SessionView session={session} streaming={false} siderCollapsed={false} />)
    })
    act(() => {
      container.querySelector<HTMLButtonElement>('[data-ask-card]')!.click()
    })
    expect(container.querySelectorAll('[data-lane]').length).toBe(2)
    act(() => {
      headerButton('查看追问树')!.click()
    })
    const event = new Event('vite-back', { cancelable: true })
    act(() => {
      document.dispatchEvent(event)
    })
    expect(event.defaultPrevented).toBe(true)
    expect(document.querySelector('[data-ask-tree-panel]')).toBeNull()
    // 层没退：仍是 2 格（下潜状态保持不变）
    expect(container.querySelectorAll('[data-lane]').length).toBe(2)
  }, 20000)
})
