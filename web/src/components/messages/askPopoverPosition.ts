export interface AnchorRect {
  left: number
  top: number
  bottom: number
  width: number
}

export interface PopoverPosition {
  top: number
  left: number
}

/**
 * 面板定位的唯一计算入口——宽度必须与 .popover 的样式公式
 * min(360px, calc(100vw - 32px)) 同款（用户实测：写死估计值会让窄屏钳位上限
 * innerWidth-360-8 失真，面板左缘或右缘出屏；这里与样式同公式，才有真自适应）。
 */
export function askPopoverPosition(
  rect: AnchorRect,
  viewportW: number,
  viewportH: number,
): PopoverPosition {
  const width = Math.min(360, viewportW - 32)
  // 高度只得估（内容由 markdown 渲染决定），钳位逻辑只须防飞顶飞底
  const heightEstimate = 190
  const EDGE = 8

  const belowFits = rect.bottom + EDGE + heightEstimate < viewportH
  const top = belowFits
    ? rect.bottom + EDGE
    : Math.max(rect.top - EDGE - heightEstimate, EDGE)

  // 中心对齐选区，钳位用实际宽度——左右都不得出屏
  const centerX = rect.left + rect.width / 2
  const left = Math.min(
    Math.max(centerX - width / 2, EDGE),
    viewportW - width - EDGE,
  )

  return { top, left }
}
