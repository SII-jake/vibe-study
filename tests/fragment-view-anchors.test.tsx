// @vitest-environment jsdom
// 父级回答里，被子分支锚定的原文要画上下划线，让"这里挂着子对话"一眼可见。
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FragmentView } from '../src/ui/FragmentView'

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

function render(el: React.ReactElement) {
  act(() => root.render(el))
}

const fragment = {
  index: 0,
  kind: 'paragraph' as const,
  raw: '利息本身也产生利息，这是它与单利的根本区别。',
  text: '利息本身也产生利息，这是它与单利的根本区别。',
}

describe('FragmentView 分支锚点下划线', () => {
  it('传入 anchors 时把对应原文画成下划线标记', () => {
    render(<FragmentView fragment={fragment} anchors={['利息本身也产生利息']} />)
    const mark = container.querySelector('mark.anchor-underline')
    expect(mark?.textContent).toBe('利息本身也产生利息')
  })

  it('多个 anchor 各自都标出', () => {
    render(
      <FragmentView fragment={fragment} anchors={['利息本身也产生利息', '根本区别']} />,
    )
    const marks = container.querySelectorAll('mark.anchor-underline')
    expect(marks).toHaveLength(2)
  })

  it('下划线与返回定位的高亮是两类标记，互不误用', () => {
    render(
      <FragmentView fragment={fragment} anchors={['利息本身也产生利息']} highlight="根本区别" />,
    )
    expect(container.querySelector('mark.anchor-underline')?.textContent).toBe('利息本身也产生利息')
    expect(container.querySelector('mark.anchor-mark')?.textContent).toBe('根本区别')
  })

  it('没有 anchors 时不出现下划线标记', () => {
    render(<FragmentView fragment={fragment} />)
    expect(container.querySelector('mark.anchor-underline')).toBeNull()
  })

  it('anchors 变化时旧标记被清掉，不会越堆越多', () => {
    render(<FragmentView fragment={fragment} anchors={['利息本身也产生利息']} />)
    render(<FragmentView fragment={fragment} anchors={['根本区别']} />)
    const marks = container.querySelectorAll('mark.anchor-underline')
    expect(marks).toHaveLength(1)
    expect(marks[0]?.textContent).toBe('根本区别')
  })
})
