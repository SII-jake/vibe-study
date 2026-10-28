import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { placeFloatingButton } from './selection'

export interface AskFabProps {
  /** 选区中心 x（视口坐标） */
  centerX: number
  /** 选区上沿 y（视口坐标） */
  top: number
  onClick(): void
}

/**
 * 按钮宽度兜底值。
 * 真实浏览器里会实测宽度；测量不到时（如测试环境）用它保证收边计算有效。
 * 与 styles.css 的 .ask-fab（padding 16px×2 + 5 个中文字）保持同步。
 */
const FALLBACK_WIDTH = 104

/**
 * 「就这段提问」浮动按钮。
 *
 * 必须 portal 到 document.body：轨道容器带 transform，按 CSS 规范它会成为
 * position:fixed 后代的包含块，按钮的 left/top 就会相对被平移过的轨道计算，
 * 轨道一移动按钮便跑到视口外。挂到 body 后坐标始终是真实视口坐标。
 */
export function AskFab({ centerX, top, onClick }: AskFabProps) {
  const ref = useRef<HTMLButtonElement>(null)
  const [width, setWidth] = useState(FALLBACK_WIDTH)

  // 实测真实宽度，让收边计算贴合实际排版；量不到就保留兜底值
  useLayoutEffect(() => {
    const measured = ref.current?.getBoundingClientRect().width ?? 0
    if (measured > 0) setWidth(measured)
  }, [])

  const pos = placeFloatingButton(
    { centerX, top: Math.max(top - 44, 12) },
    { width: window.innerWidth, height: window.innerHeight, buttonWidth: width },
  )

  // SSR / 极端环境下没有 body 时退化为不渲染，避免 portal 抛错
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  if (!mounted) return null

  return createPortal(
    <button
      ref={ref}
      type="button"
      className="ask-fab"
      style={{ left: pos.centerX, top: pos.top }}
      onClick={onClick}
    >
      就这段提问
    </button>,
    document.body,
  )
}
