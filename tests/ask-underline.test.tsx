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

// 真机反馈 2026-11-25「有时候选中的文字没有下划线」：实测把「有时候」定位成
// 确定形态——引用块 / 表格 / 代码块内的选区，以及跨段落、跨列表项的跨块选区，
// 全都只有兜底卡、没有下划线。根因两层：blockTextOf 只认 paragraph/heading/list
// （其余块返回空串），逐块 indexOf 匹配也接不住跨块选区。
describe('下划线覆盖所有可选中的正文形态', () => {
  const markedTexts = () =>
    [...container.querySelectorAll('[data-ask-referenced]')].map((el) => el.textContent)

  it('引用块内选中的片段有下划线（不再只落兜底卡）', () => {
    render({ content: '> 引用块里的这句被追问过。', fragmentAsk: [ask('u-q', '被追问过')] })
    expect(markedTexts()).toEqual(['被追问过'])
    expect(container.querySelector('[data-ask-fallback]')).toBeNull()
  })

  it('表格单元格内选中的片段有下划线', () => {
    render({
      content: '| 列A | 列B |\n| --- | --- |\n| 单元格内容 | 别的 |',
      fragmentAsk: [ask('u-t', '单元格内容')],
    })
    expect(markedTexts()).toEqual(['单元格内容'])
  })

  it('代码块内选中的片段有下划线', () => {
    render({ content: '```js\nconst target = 1\n```', fragmentAsk: [ask('u-c', 'const target = 1')] })
    const marked = container.querySelector('.md-code-block [data-ask-referenced]')
    expect(marked).toBeTruthy()
    expect(marked!.textContent).toBe('const target = 1')
  })

  it('跨段落选中：两段各打与自己相交的部分，不落兜底卡', () => {
    render({
      content: '第一段结尾在此，然后继续。\n\n第二段开头接上。',
      fragmentAsk: [ask('u-x', '继续。\n\n第二段开头')],
    })
    expect(markedTexts()).toEqual(['继续。', '第二段开头'])
    expect(container.querySelector('[data-ask-fallback]')).toBeNull()
  })

  it('跨列表项选中：两个列表项各打与自己相交的部分', () => {
    render({
      content: '- 第一项文字\n- 第二项文字',
      fragmentAsk: [ask('u-l', '文字\n第二项文字')],
    })
    expect(markedTexts()).toEqual(['文字', '第二项文字'])
  })

  it('引用块内跨两段选中', () => {
    render({
      content: '> 引用第一段。\n>\n> 引用第二段。',
      fragmentAsk: [ask('u-b', '引用第一段。\n\n引用第二段。')],
    })
    expect(markedTexts()).toEqual(['引用第一段。', '引用第二段。'])
  })

  it('下划线仍可点进追问（跨块命中的每一段都可点）', () => {
    const onAskOpen = vi.fn()
    render({
      content: '第一段结尾在此，然后继续。\n\n第二段开头接上。',
      fragmentAsk: [ask('u-x2', '继续。\n\n第二段开头')],
      onAskOpen,
    })
    const marks = container.querySelectorAll('[data-ask-referenced]')
    expect(marks.length).toBe(2)
    act(() => {
      ;(marks[1] as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(onAskOpen).toHaveBeenCalledWith('u-x2')
  })
})
