import { type RefObject, useCallback, useEffect, useState } from 'react'
import { readSelection, type SelectionReading } from './selection'

export interface PickedSelection {
  reading: SelectionReading
  /** 浮动按钮的中心位置，视口坐标 */
  centerX: number
  top: number
}

/** 监听正文选区，选出可作锚点的一段话并给出浮动按钮位置。 */
export function useSelectionAnchor(containerRef: RefObject<HTMLElement>): {
  picked: PickedSelection | null
  clear: () => void
} {
  const [picked, setPicked] = useState<PickedSelection | null>(null)

  useEffect(() => {
    const handler = () => {
      const selection = window.getSelection()
      const container = containerRef.current
      if (!selection || selection.rangeCount === 0 || selection.isCollapsed || !container) {
        setPicked(null)
        return
      }
      const range = selection.getRangeAt(0)
      const reading = readSelection(container, range)
      if (!reading) {
        setPicked(null)
        return
      }
      const rect = range.getBoundingClientRect()
      setPicked({ reading, centerX: rect.left + rect.width / 2, top: rect.top })
    }

    document.addEventListener('selectionchange', handler)
    return () => document.removeEventListener('selectionchange', handler)
  }, [containerRef])

  const clear = useCallback(() => {
    window.getSelection()?.removeAllRanges()
    setPicked(null)
  }, [])

  return { picked, clear }
}
