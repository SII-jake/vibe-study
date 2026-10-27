// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { readSelection } from '../src/ui/selection'

let container: HTMLElement

function mount(): void {
  container = document.createElement('div')
  container.innerHTML = [
    '<div data-fragment-index="0"><p>复利是指利息也产生利息。</p></div>',
    '<div data-fragment-index="1"><p>长期看时间的影响更大。</p></div>',
  ].join('')
  document.body.appendChild(container)
}

function textNodeOf(fragmentIndex: number): Text {
  return container.querySelector(`[data-fragment-index="${fragmentIndex}"] p`)!.firstChild as Text
}

function rangeOver(node: Text, start: number, end: number): Range {
  const range = document.createRange()
  range.setStart(node, start)
  range.setEnd(node, end)
  return range
}

beforeEach(() => {
  document.body.innerHTML = ''
  mount()
})

describe('readSelection', () => {
  it('读出片段序号与选中原文', () => {
    expect(readSelection(container, rangeOver(textNodeOf(0), 0, 2))).toEqual({
      fragmentIndex: 0,
      text: '复利',
    })
  })

  it('跨行内标签选中时文本连续', () => {
    const nested = document.createElement('div')
    nested.setAttribute('data-fragment-index', '0')
    nested.innerHTML = '<p>单利与<strong>复利</strong>的差别</p>'
    container.innerHTML = ''
    container.appendChild(nested)
    const range = document.createRange()
    const para = nested.querySelector('p')!
    range.setStart(para.firstChild as Text, 0)
    range.setEnd((para.querySelector('strong')!.firstChild as Text), 2)
    expect(readSelection(container, range)?.text).toBe('单利与复利')
  })

  it('跨片段选中时截断在起始片段内', () => {
    const range = document.createRange()
    range.setStart(textNodeOf(0), 7)
    range.setEnd(textNodeOf(1), 4)
    expect(readSelection(container, range)).toEqual({ fragmentIndex: 0, text: '产生利息。' })
  })

  it('折叠选区返回 null', () => {
    expect(readSelection(container, rangeOver(textNodeOf(0), 2, 2))).toBeNull()
  })

  it('只选中空白时返回 null', () => {
    const spacer = document.createElement('div')
    spacer.setAttribute('data-fragment-index', '2')
    spacer.textContent = '   '
    container.appendChild(spacer)
    const range = document.createRange()
    range.setStart(spacer.firstChild as Text, 0)
    range.setEnd(spacer.firstChild as Text, 3)
    expect(readSelection(container, range)).toBeNull()
  })

  it('选区在容器之外时返回 null', () => {
    const outside = document.createElement('p')
    outside.textContent = '外部文字'
    document.body.appendChild(outside)
    const range = document.createRange()
    range.setStart(outside.firstChild as Text, 0)
    range.setEnd(outside.firstChild as Text, 2)
    expect(readSelection(container, range)).toBeNull()
  })

  it('片段属于某条回答时带回该消息 id', () => {
    container.innerHTML = [
      '<div data-message-id="m-a1">',
      '  <div data-fragment-index="0"><p>第一轮段落</p></div>',
      '</div>',
      '<div data-message-id="m-a2">',
      '  <div data-fragment-index="1"><p>第二轮段落</p></div>',
      '</div>',
    ].join('')
    const node = container.querySelector('[data-fragment-index="1"] p')!.firstChild as Text
    const range = rangeOver(node, 0, 4)
    expect(readSelection(container, range)).toEqual({
      fragmentIndex: 1,
      text: '第二轮段',
      messageId: 'm-a2',
    })
  })
})
