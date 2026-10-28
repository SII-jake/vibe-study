import { useCallback, useEffect, useRef, useState } from 'react'

export interface PaneWidthOptions {
  /** 初始右栏宽度（px）；用户拖过之后以拖拽结果为准 */
  initial?: number
  /** 右栏最小宽度，防止拖没 */
  min?: number
  /** 右栏最大宽度，防止吃掉中栏 */
  max?: number
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
      // 分隔条在右栏左侧：向左拖（clientX 变小）右栏变宽
      const next = drag.startWidth + (drag.startX - event.clientX)
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
  }, [dragging, min, max])

  return [width, dragging, startDrag]
}
