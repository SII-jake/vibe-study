// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { clearHighlights, highlightInFragment } from '../src/ui/dom-highlight'

function mount(html: string): HTMLElement {
  const root = document.createElement('div')
  root.innerHTML = html
  document.body.appendChild(root)
  return root
}

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('highlightInFragment', () => {
  it('把锚点原文包成 mark 元素', () => {
    const root = mount('<div data-fragment-index="0">利息也产生利息</div>')
    expect(highlightInFragment(root.firstElementChild as HTMLElement, '也产生')).toBe(true)
    expect(root.querySelector('mark.anchor-mark')?.textContent).toBe('也产生')
  })

  it('原文跨行内标签时仍能包成单个 mark', () => {
    const root = mount('<div data-fragment-index="0">单利与<strong>复利</strong>的差别</div>')
    expect(highlightInFragment(root.firstElementChild as HTMLElement, '单利与复利')).toBe(true)
    expect(root.querySelector('mark.anchor-mark')?.textContent).toBe('单利与复利')
  })

  it('空白与渲染结果不一致时仍能标出', () => {
    const root = mount('<div data-fragment-index="0">第一点 第二点</div>')
    expect(highlightInFragment(root.firstElementChild as HTMLElement, '第一点第二点')).toBe(true)
    expect(root.querySelector('mark.anchor-mark')?.textContent).toBe('第一点 第二点')
  })

  it('只改目标片段，不动其他片段', () => {
    const root = mount(
      '<div data-fragment-index="0">第一段</div><div data-fragment-index="1">第二段</div>',
    )
    highlightInFragment(root.querySelector('[data-fragment-index="1"]') as HTMLElement, '第二段')
    expect(root.querySelector('[data-fragment-index="0"] mark')).toBeNull()
    expect(root.querySelector('[data-fragment-index="1"] mark')?.textContent).toBe('第二段')
  })

  it('原文不存在时返回 false 且不改动 DOM', () => {
    const root = mount('<div data-fragment-index="0">利息也产生利息</div>')
    expect(highlightInFragment(root.firstElementChild as HTMLElement, '已删除的句子')).toBe(false)
    expect(root.querySelector('mark')).toBeNull()
  })

  it('片段元素自身带 data-fragment-index 时也能命中', () => {
    const element = document.createElement('div')
    element.setAttribute('data-fragment-index', '3')
    element.innerHTML = '<p>利息也产生利息</p>'
    document.body.appendChild(element)
    expect(highlightInFragment(element, '也产生')).toBe(true)
    expect(element.querySelector('mark.anchor-mark')?.textContent).toBe('也产生')
  })
})

describe('clearHighlights', () => {
  it('拆掉 mark 并保留文字', () => {
    const root = mount('<div data-fragment-index="0">利息也产生利息</div>')
    highlightInFragment(root.firstElementChild as HTMLElement, '也产生')
    clearHighlights(root)
    expect(root.querySelector('mark')).toBeNull()
    expect(root.textContent).toBe('利息也产生利息')
  })
})
