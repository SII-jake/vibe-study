/** 把浏览器选区解析成锚点：片段序号 + 归一化后的选中原文。 */

export interface SelectionReading {
  fragmentIndex: number
  text: string
  /** 选中文字所属的那条回答（同节点多轮时用于定位分支挂在哪一轮） */
  messageId?: string
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
  if (normalized === '') return null
  const turnId = startFragment.closest('[data-message-id]')?.getAttribute('data-message-id') ?? undefined
  const reading: SelectionReading = { fragmentIndex, text: normalized }
  if (turnId) reading.messageId = turnId
  return reading
}

export interface ButtonAnchor {
  /** 选区中心 x（视口坐标） */
  centerX: number
  /** 选区上沿 y（视口坐标） */
  top: number
}

export interface ButtonViewport {
  width: number
  height: number
  /** 浮动按钮自身宽度，用于把整颗按钮收进视口 */
  buttonWidth: number
  /** 与视口边缘保留的间距 */
  margin?: number
}

/**
 * 把浮动按钮收进视口。
 * 选区贴右边缘时若直接用选区中心定位，按钮有一半落在窗口外，用户点不到；
 * 因此按按钮实际宽度夹住左右两端。纵向只保证不被上缘裁掉。
 */
export function placeFloatingButton(anchor: ButtonAnchor, viewport: ButtonViewport): ButtonAnchor {
  const margin = viewport.margin ?? 8
  const half = viewport.buttonWidth / 2
  const minX = half + margin
  const maxX = viewport.width - half - margin

  // 视口比按钮还窄时没有合法区间，退到居中，避免产生负坐标
  const centerX =
    minX > maxX ? Math.max(0, viewport.width / 2) : Math.min(maxX, Math.max(minX, anchor.centerX))

  return { centerX, top: Math.max(margin, anchor.top) }
}
