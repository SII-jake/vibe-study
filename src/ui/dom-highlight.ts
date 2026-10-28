/** 在已渲染片段的 DOM 上标出锚点原文，返回是否命中。 */

import { locateRange } from '../domain/text-match'

const MARK_CLASS = 'anchor-mark'
/** 分支锚点原文的标记：下划线样式，跟返回定位用的高亮分开 */
const ANCHOR_CLASS = 'anchor-underline'

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

function wrapFirstMatch(root: HTMLElement, target: string, markClass: string): boolean {
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
  mark.className = markClass
  // 区间跨越行内元素时 surroundContents 会抛错，改为取出内容再整体包一层。
  mark.appendChild(domRange.extractContents())
  domRange.insertNode(mark)
  return true
}

/** 在片段元素内部标出 target；片段元素自身即带 data-fragment-index，不再向下查找。 */
export function highlightInFragment(element: HTMLElement, target: string): boolean {
  const trimmed = target.trim()
  if (trimmed === '') return false
  return wrapFirstMatch(element, trimmed, MARK_CLASS)
}

/**
 * 在片段元素内部标出分支锚点原文。
 * 被选中开过过支的那段文字，在父级回答里以下划线常驻，
 * 让 "这里挂着子对话" 一眼可见。
 */
export function highlightAnchorText(element: HTMLElement, target: string): boolean {
  const trimmed = target.trim()
  if (trimmed === '') return false
  return wrapFirstMatch(element, trimmed, ANCHOR_CLASS)
}

function clearMarks(root: HTMLElement, markClass: string): void {
  root.querySelectorAll(`mark.${markClass}`).forEach((mark) => {
    const parent = mark.parentNode
    if (!parent) return
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark)
    parent.removeChild(mark)
    parent.normalize()
  })
}

export function clearHighlights(root: HTMLElement): void {
  clearMarks(root, MARK_CLASS)
}

/** 只清下划线标记，不动高亮标记。 */
export function clearAnchorMarks(root: HTMLElement): void {
  clearMarks(root, ANCHOR_CLASS)
}
