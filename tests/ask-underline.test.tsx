// @vitest-environment jsdom
// 下划线片段可点击进入追问（真机反馈 2026-11-22；口径见
// docs/decisions/2026-11-19-ask-fragment-level-panes.md §二.5：
// 「点卡片与点下划线同一路径：子对话进右栏」）。
// 现状缺陷：渲染层只给 [data-ask-referenced] 打了下划线，没有携带
// 目标追问 rootId、也没有点击处理——用户点下划线毫无反应。
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

const { Markdown } = await import('../web/src/components/markdown/Markdown.js')

let container: HTMLDivElement
let root: Root
beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => act(() => root.unmount()))

const render = (props: { content: string; fragmentAsk?: unknown[]; onAskOpen?: (id: string) => void }) =>
  act(() => {
    root.render(
      <Markdown
        content={props.content}
        loading={false}
        cacheKey="u1"
        disableLink={false}
        fragmentAsk={props.fragmentAsk as never}
        onAskOpen={props.onAskOpen}
      />,
    )
  })

const ask = (rootId: string, anchorText: string) => ({
  rootId,
  question: '追问：' + anchorText,
  anchorText,
  branchCount: 1,
})

describe('下划线片段点击进入追问', () => {
  it('被追片段带目标 rootId（data-ask-root），点下划线触发 onAskOpen', () => {
    const onAskOpen = vi.fn()
    render({
      content: '第一段正文，这里有一段被追问过的文字。',
      fragmentAsk: [ask('u-ask-1', '被追问过的文字')],
      onAskOpen,
    })
    const marked = container.querySelector('[data-ask-referenced]') as HTMLElement
    expect(marked).toBeTruthy()
    expect(marked.getAttribute('data-ask-root')).toBe('u-ask-1')
    act(() => {
      marked.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(onAskOpen).toHaveBeenCalledWith('u-ask-1')
  })

  it('列表项内的下划线同样可点（嵌套锚点不能丢入口）', () => {
    const onAskOpen = vi.fn()
    render({
      content: '- 列表项里也有被追问的内容\n- 第二项',
      fragmentAsk: [ask('u-ask-2', '被追问的内容')],
      onAskOpen,
    })
    const marked = container.querySelector('[data-ask-referenced]') as HTMLElement
    expect(marked?.getAttribute('data-ask-root')).toBe('u-ask-2')
    act(() => {
      marked.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(onAskOpen).toHaveBeenCalledWith('u-ask-2')
  })

  it('点下划线内的链接优先走链接，不误触发追问', () => {
    const onAskOpen = vi.fn()
    render({
      content: '见 [某篇文章](https://example.com/a) 这段被追问。',
      fragmentAsk: [ask('u-ask-3', '[某篇文章](https://example.com/a)')],
      onAskOpen,
    })
    const link = container.querySelector('[data-ask-referenced] a') as HTMLElement
    if (link) {
      act(() => {
        link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
      })
      expect(onAskOpen).not.toHaveBeenCalled()
    }
  })
})
