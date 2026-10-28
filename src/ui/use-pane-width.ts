import { useCallback, useEffect, useRef, useState } from 'react'

export interface PaneWidthOptions {
  /** 初始宽度（px）；用户拖过之后以拖拽结果为准 */
  initial?: number
  /** 最小宽度，防止拖没 */
  min?: number
  /** 最大宽度，防止把邻栏挤没 */
  max?: number
  /**
   * 分隔条哪一侧的栏跟着变宽：
   * - 'left'（默认）：分隔条左侧是目标栏，向左拖变宽 —— 用于「右栏宽度」
   * - 'right'：分隔条右侧是目标栏，向右拖变宽 —— 用于「中栏宽度」
   */
  grow?: 'left' | 'right'
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * 手动拖分栏边界：右栏宽度由用户拖动决定。
 * 分隔条在中栏与右栏之间；向左拖（远离右栏）右栏变宽，
 * 向右拖（朝右栏）右栏变窄；松手后停在当前宽度。
 */
export function usePaneWidth({
  initial = 360,
  min = 240,
  max = 560,
  grow = 'left',
}: PaneWidthOptions = {}): [width: number, dragging: boolean, startDrag: (event: React.PointerEvent) => void] {
  const [width, setWidth] = useState(() => clamp(initial, min, max))
  const [dragging, setDragging] = useState(false)
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null)

  const startDrag = useCallback(
    (event: React.PointerEvent) => {
      event.preventDefault()
      dragRef.current = { startX: event.clientX, startWidth: width }
      setDragging(true)
    },
    [width],
  )

  useEffect(() => {
    if (!dragging) return undefined

    const onMove = (event: PointerEvent) => {
      const drag = dragRef.current
      if (!drag) return
      // grow='left'：向左拖（clientX 变小）目标栏变宽
      // grow='right'：向右拖（clientX 变大）目标栏变宽
      const delta =
        grow === 'right' ? event.clientX - drag.startX : drag.startX - event.clientX
      const next = drag.startWidth + delta
      setWidth(clamp(next, min, max))
    }
    const onUp = () => {
      dragRef.current = null
      setDragging(false)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [dragging, min, max, grow])

  return [width, dragging, startDrag]
}
