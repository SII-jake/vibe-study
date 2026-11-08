// @vitest-environment jsdom
/**
 * 聊天界面改版测试：DS 参考同向的形态——
 *   用户消息是右侧色块气泡；助手回答平铺；
 *   所有提问/追问都走气泡，第一个提问不再渲染成 h1 大标题；
 *   输入区回收成一个圆角芯片，回车（非 shift/ctrl）就发送。
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NodePage } from '../src/ui/NodePage'
import { StartPage } from '../src/ui/StartPage'
import type { LearnData } from '../src/app/store'
import { addChildNode } from '../src/domain/tree'
import { appendAnswer, appendUserMessage } from '../src/domain/tree-ops'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  window.sessionStorage.clear()
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function makeData(nodes: LearnData['nodes']): LearnData {
  return {
    ready: true,
    nodes,
    streamingNodeId: null,
    streamingText: '',
    streamingStatus: null,
    error: null,
    health: { configured: true, model: 'm', models: [] },
    refreshHealth: () => {},
    createTopic: () => 'id',
    askAt: () => 'id',
    followUp: () => {},
    regenerate: () => {},
    remove: () => {},
    seedDemo: async () => {},
    clearError: () => {},
    stopStreaming: () => {},
  }
}

function render(el: React.ReactElement) {
  act(() => root.render(el))
}

function type(el: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
  setter?.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

function press(el: HTMLElement, init: KeyboardEventInit) {
  el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }))
}

/* ---------- 对话气泡形态 ---------- */

const rootNode = addChildNode({
  id: 'child',
  parentId: 'parent',
  anchor: { messageId: 'p-m1', fragmentIndex: 0, text: '利息本身也产生利息' },
  question: '那和单利比呢？',
  createdAt: 2,
})
const withAnswer = appendAnswer([rootNode], 'child', '单利是线性的，复利是指数的。', 3)
const withFollowUp = appendAnswer(
  appendUserMessage(withAnswer, 'child', '再给一个具体数字例', 4),
  'child',
  '例如本金 1 万元，年化 10%，30 年后单利 4 万、复利 17.4 万。',
  5,
)

describe('NodePage 聊天气泡形态', () => {
  it('第一条提问也走用户气泡（.msg-user），不再以大标题呈现', () => {
    render(
      <NodePage data={makeData(withAnswer)} nodeId="child" onNavigate={() => {}} onOpenTree={() => {}} />,
    )
    const first = container.querySelector('.msg-user')
    expect(first).not.toBeNull()
    expect(first?.textContent).toContain('那和单利比呢？')
    // h1 不再是提问载体：首轮标题形态撤回，对话回归对话
    expect(container.querySelector('h1.reader-question')).toBeNull()
  })

  it('追问同样是用户气泡（.msg-user），且与助手回答 .fragment 分离', () => {
    render(
      <NodePage data={makeData(withFollowUp)} nodeId="child" onNavigate={() => {}} onOpenTree={() => {}} />,
    )
    const bubbles = container.querySelectorAll('.msg-user')
    expect(bubbles.length).toBeGreaterThanOrEqual(2)
    expect(bubbles[1]?.textContent).toContain('再给一个具体数字例')
    // 旧类名退场：追问不再靠「左侧竖条 + 浅色块」表示
    expect(container.querySelector('.turn-user')).toBeNull()
    expect(container.querySelectorAll('.fragment').length).toBeGreaterThan(0)
  })
})

/* ---------- 输入区：芯片形态与回车发送 ---------- */

describe('StartPage 输入区', () => {
  it('回车直接发送（不再要求按住 ctrl/cmd）', () => {
    const onCreated = vi.fn()
    render(<StartPage data={makeData([])} onCreated={onCreated} />)
    const textarea = container.querySelector('textarea')!
    act(() => type(textarea, '复利和时间的关系'))
    act(() => press(textarea, { key: 'Enter' }))
    expect(onCreated).toHaveBeenCalledTimes(1)
  })

  it('Ctrl+Enter 也发送；Shift+Enter 只换行不发送', () => {
    const onCreated = vi.fn()
    render(<StartPage data={makeData([])} onCreated={onCreated} />)
    const textarea = container.querySelector('textarea')!
    act(() => type(textarea, '复利和时间的关系'))
    act(() => press(textarea, { key: 'Enter', shiftKey: true }))
    expect(onCreated).not.toHaveBeenCalled()
    act(() => press(textarea, { key: 'Enter', ctrlKey: true }))
    expect(onCreated).toHaveBeenCalledTimes(1)
  })

  it('中文输入法组合中（isComposing）回车不发送，回车完成合成才发送', () => {
    const onCreated = vi.fn()
    render(<StartPage data={makeData([])} onCreated={onCreated} />)
    const textarea = container.querySelector('textarea')!
    act(() => type(textarea, '复利和时间的关系'))
    act(() => press(textarea, { key: 'Enter', isComposing: true }))
    expect(onCreated).not.toHaveBeenCalled()
    act(() => press(textarea, { key: 'Enter' }))
    expect(onCreated).toHaveBeenCalledTimes(1)
  })

  it('输入区收拢为圆角芯片（.composer），不再渲染旧的 follow-bar 形态', () => {
    render(<StartPage data={makeData([])} onCreated={() => {}} />)
    expect(container.querySelector('.composer')).not.toBeNull()
    expect(container.querySelector('.follow-bar')).toBeNull()
  })
})
