/**
 * 阅读现场记忆：记住某个节点读到哪、从哪个锚点回来。
 * 存在 sessionStorage，随标签页关闭而失效，不进入长期数据。
 */

export interface FocusPoint {
  fragmentIndex: number
  text: string
}

const SCROLL_PREFIX = 'vibe-study.scroll.'
const FOCUS_PREFIX = 'vibe-study.focus.'

function read(key: string): string | null {
  try {
    return sessionStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value)
  } catch {
    // 隐私模式下写入被拒时不影响阅读，只是失去返回现场能力。
  }
}

export function rememberReadingPosition(nodeId: string, scrollTop: number): void {
  write(`${SCROLL_PREFIX}${nodeId}`, String(Math.round(scrollTop)))
}

export function readReadingPosition(nodeId: string): number | null {
  const raw = read(`${SCROLL_PREFIX}${nodeId}`)
  if (raw === null) return null
  const value = Number(raw)
  return Number.isFinite(value) ? value : null
}

export function rememberFocus(nodeId: string, point: FocusPoint): void {
  write(`${FOCUS_PREFIX}${nodeId}`, JSON.stringify(point))
}

/** 读出并清除：返回锚点只应触发一次滚动与高亮。 */
export function takeFocus(nodeId: string): FocusPoint | null {
  const raw = read(`${FOCUS_PREFIX}${nodeId}`)
  if (raw === null) return null
  try {
    sessionStorage.removeItem(`${FOCUS_PREFIX}${nodeId}`)
  } catch {
    // 清除失败时最坏是重复高亮一次，不影响阅读。
  }
  try {
    const parsed = JSON.parse(raw) as Partial<FocusPoint>
    if (typeof parsed.fragmentIndex !== 'number' || typeof parsed.text !== 'string') return null
    return { fragmentIndex: parsed.fragmentIndex, text: parsed.text }
  } catch {
    return null
  }
}
