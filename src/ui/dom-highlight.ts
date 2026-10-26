/** 在已渲染片段的 DOM 上标出锚点原文，返回是否命中。 */

import { locateRange } from '../domain/text-match'

const MARK_CLASS = 'anchor-mark'

function textNodesOf(root: HTMLElement): Text[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  let current = walker.nextNode()
  while (current) {
    nodes.push(current as Text)
    current = walker.nextNode()
  }
  return nodes
}

function wrapFirstMatch(root: HTMLElement, target: string): boolean {
  const nodes = textNodesOf(root)
  const fullText = nodes.map((node) => node.data).join('')
  const range = locateRange(fullText, target)
  if (!range) return false
  const { start, end } = range

  let cursor = 0
  let startNode: Text | null = null
  let startOffset = 0
  let endNode: Text | null = null
  let endOffset = 0

  for (const node of nodes) {
    const next = cursor + node.data.length
    if (startNode === null && start >= cursor && start < next) {
      startNode = node
      startOffset = start - cursor
    }
    if (startNode !== null && end <= next) {
      endNode = node
      endOffset = end - cursor
      break
    }
    cursor = next
  }

  if (startNode === null || endNode === null) return false

  const domRange = document.createRange()
  domRange.setStart(startNode, startOffset)
  domRange.setEnd(endNode, endOffset)
  const mark = document.createElement('mark')
  mark.className = MARK_CLASS
  // 区间跨越行内元素时 surroundContents 会抛错，改为取出内容再整体包一层。
  mark.appendChild(domRange.extractContents())
  domRange.insertNode(mark)
  return true
}

/** 在片段元素内部标出 target；片段元素自身即带 data-fragment-index，不再向下查找。 */
export function highlightInFragment(element: HTMLElement, target: string): boolean {
  const trimmed = target.trim()
  if (trimmed === '') return false
  return wrapFirstMatch(element, trimmed)
}

export function clearHighlights(root: HTMLElement): void {
  root.querySelectorAll(`mark.${MARK_CLASS}`).forEach((mark) => {
    const parent = mark.parentNode
    if (!parent) return
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark)
    parent.removeChild(mark)
    parent.normalize()
  })
}
