// @vitest-environment jsdom
// 追问树导航面板（decisions/2026-11-25-ask-tree-navigator.md §三）。
// 面板经 Modal portal 到 document.body，断言一律查 body 而非渲染容器。
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Session } from '../web/src/services/chat/types.js'

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  }),
})

const { AskTreePanel } = await import('../web/src/components/session/AskTreePanel.js')
const { buildAskTree } = await import('../web/src/components/messages/askTree.js')

const user = (
  id: string,
  parentId: string | null,
  ask?: { anchorText: string; anchorMessageId: string; title?: string },
  selectedChildId?: string,
) => ({
  id,
  role: 'user' as const,
  content: ask ? `你在回答中写过这段内容：\n\n> ${ask.anchorText}\n\n我的追问：${id} 的内容` : `${id} 的提问`,
  files: [],
  createdAt: 1,
  parentId,
  selectedChildId,
  ...(ask ? { ask } : {}),
})

const assistant = (id: string, parentId: string, text: string, selectedChildId?: string) =>
  ({
    id,
    role: 'assistant' as const,
    createdAt: 2,
    model: null,
    prefix: true,
    status: 'done' as const,
    parentId,
    selectedChildId,
    blocks: [{ type: 'text' as const, text }],
  }) as never

const session: Session = {
  id: 's-panel',
  title: '会话标题',
  createdAt: 1,
  updatedAt: 1,
  rootMessageId: 'u1',
  messages: [
    user('u1', null, undefined, 'a1'),
    assistant('a1', 'u1', '主线回答。'),
    user('q1', 'a1', { anchorText: '主线回答。', anchorMessageId: 'a1', title: '第一问' }, 'r1'),
    assistant('r1', 'q1', '第一答。'),
    user('q2', 'a1', { anchorText: '主线回答。', anchorMessageId: 'a1' }, 'r2'),
    assistant('r2', 'q2', '第二答。'),
    user('q3', 'r1', { anchorText: '第一答。', anchorMessageId: 'r1', title: '嵌套一问' }, 'r3'),
    assistant('r3', 'q3', '嵌套一答。'),
  ],
}

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
  // Modal 走 portal，卸载后清理残留节点
  document.querySelectorAll('[data-ask-tree-panel]').forEach((node) => node.remove())
})

const renderPanel = (currentId: string | null, onJump = vi.fn(), onClose = vi.fn()) => {
  const tree = buildAskTree(session, '会话标题')
  act(() => {
    root.render(<AskTreePanel tree={tree} currentId={currentId} onJump={onJump} onClose={onClose} />)
  })
  return { onJump, onClose }
}

const rows = () => [...document.querySelectorAll('[data-ask-tree-row]')] as HTMLElement[]
const rowOf = (id: string) => rows().find((row) => row.dataset.askTreeRow === id)

describe('AskTreePanel（追问树面板）', () => {
  it('渲染出根与展开路径上的节点，标题用 ask.title', () => {
    renderPanel('q3')
    const ids = rows().map((row) => row.dataset.askTreeRow)
    expect(ids).toContain('u1')
    expect(ids).toContain('q1')
    expect(ids).toContain('q3')
    expect(rowOf('q1')!.textContent).toContain('第一问')
  })

  it('当前所在位置有标记（aria-current）', () => {
    renderPanel('q3')
    expect(rowOf('q3')!.getAttribute('aria-current')).toBe('true')
    expect(rowOf('q1')!.getAttribute('aria-current')).toBeNull()
  })

  it('缩进按层深递增（depth 落在 data 属性上供样式使用）', () => {
    renderPanel('q3')
    expect(rowOf('u1')!.dataset.depth).toBe('0')
    expect(rowOf('q1')!.dataset.depth).toBe('1')
    expect(rowOf('q3')!.dataset.depth).toBe('2')
  })

  it('点击某个追问直接跳转并关闭面板', () => {
    const { onJump, onClose } = renderPanel('q3')
    act(() => {
      rowOf('q1')!.click()
    })
    expect(onJump).toHaveBeenCalledWith('q1')
    expect(onClose).toHaveBeenCalled()
  })

  it('点当前所在行不重复跳转，只关闭面板', () => {
    const { onJump, onClose } = renderPanel('q3')
    act(() => {
      rowOf('q3')!.click()
    })
    expect(onJump).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('折叠后子节点从列表消失，再展开回来', () => {
    renderPanel('q3')
    const toggle = rowOf('q1')!.querySelector('[data-ask-tree-toggle]') as HTMLElement
    expect(toggle).toBeTruthy()
    act(() => {
      toggle.click()
    })
    expect(rowOf('q3')).toBeUndefined()
    act(() => {
      ;(rowOf('q1')!.querySelector('[data-ask-tree-toggle]') as HTMLElement).click()
    })
    expect(rowOf('q3')).toBeTruthy()
  })

  it('当前路径上的节点默认展开，位置不会被折叠藏起来', () => {
    renderPanel('q3')
    expect(rowOf('q3')).toBeTruthy()
  })

  it('提供全部展开与全部折叠', () => {
    renderPanel('q3')
    act(() => {
      ;(document.querySelector('[data-ask-tree-expand-all]') as HTMLElement).click()
    })
    // 全部展开后 q2 也可见
    expect(rowOf('q2')).toBeTruthy()
    act(() => {
      ;(document.querySelector('[data-ask-tree-collapse-all]') as HTMLElement).click()
    })
    expect(rows().map((row) => row.dataset.askTreeRow)).toEqual(['u1'])
  })

  it('不做筛选框（用户明确本版不要，搜索另行设计）', () => {
    renderPanel('q3')
    expect(document.querySelector('[data-ask-tree-panel] input')).toBeNull()
  })

  it('无追问时给出空态文案，不留空白面板', () => {
    const emptyTree = buildAskTree(
      {
        id: 's-empty',
        title: '空',
        createdAt: 1,
        updatedAt: 1,
        rootMessageId: 'u1',
        messages: [user('u1', null, undefined, 'a1'), assistant('a1', 'u1', '答。')],
      },
      '空',
    )
    act(() => {
      root.render(
        <AskTreePanel tree={emptyTree} currentId="u1" onJump={vi.fn()} onClose={vi.fn()} />,
      )
    })
    expect(document.querySelector('[data-ask-tree-empty]')).toBeTruthy()
  })
})
