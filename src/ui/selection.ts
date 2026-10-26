/** 把浏览器选区解析成锚点：片段序号 + 归一化后的选中原文。 */

export interface SelectionReading {
  fragmentIndex: number
  text: string
}

function owningFragment(node: Node, container: HTMLElement): HTMLElement | null {
  const element =
    node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as HTMLElement | null)
  const fragment = element?.closest<HTMLElement>('[data-fragment-index]') ?? null
  return fragment && container.contains(fragment) ? fragment : null
}

/**
 * 跨片段选择时按起始片段的末尾截断，保证锚点原文一定属于一个片段。
 * 截断比报错更贴合使用意图：用户从某句开始划，那就是他想问的起点。
 */
export function readSelection(container: HTMLElement, range: Range): SelectionReading | null {
  if (range.collapsed) return null

  const startFragment = owningFragment(range.startContainer, container)
  if (!startFragment) return null

  const fragmentIndex = Number(startFragment.dataset.fragmentIndex)
  if (!Number.isInteger(fragmentIndex)) return null

  const endFragment = owningFragment(range.endContainer, container)
  let text: string
  if (endFragment === startFragment) {
    text = range.toString()
  } else {
    const clamped = range.cloneRange()
    clamped.setEnd(startFragment, startFragment.childNodes.length)
    text = clamped.toString()
  }

  const normalized = text.replace(/\s+/g, ' ').trim()
  return normalized === '' ? null : { fragmentIndex, text: normalized }
}
