// 分栏宽度与手动调整（真机反馈 2026-11-22）：
// ① 最右 lane 显示不全——viewportWidth 误用 window.innerWidth（含被侧栏吃掉的宽度），
//    右侧 lane 被算宽了整整一个侧栏，视觉上右边被裁掉。
// ② 中/右两栏无法手动调整宽度。
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PANE_RATIO,
  MAX_PANE_RATIO,
  MIN_PANE_RATIO,
  clampPaneRatio,
  laneWidthOf,
  paneWidths,
  ratioFromPointer,
} from '../web/src/services/chat/trackView'

describe('分栏宽度：以容器宽度为基准，右侧 lane 不再溢出', () => {
  it('paneWidths 两栏宽度之和恰为容器宽（不多出侧栏那么一块）', () => {
    const { centerWidth, rightWidth } = paneWidths(1000, 0.5)
    expect(centerWidth + rightWidth).toBe(1000)
    expect(centerWidth).toBe(500)
    expect(rightWidth).toBe(500)
  })

  it('laneWidthOf 用容器宽做视口宽时，末格不再超出视口', () => {
    const containerWidth = 1000
    const { centerWidth } = paneWidths(containerWidth, 0.5)
    const lanes = 3
    const last = laneWidthOf(lanes - 1, lanes, false, centerWidth, containerWidth)
    expect(centerWidth + last).toBe(containerWidth)
  })

  it('旧口径（window.innerWidth 当视口宽）会多出侧栏宽——红线说明缺陷机理', () => {
    const containerWidth = 740 // 侧栏 261 展开时的真实内容区
    const innerWidth = 1001
    const { centerWidth } = paneWidths(containerWidth, 0.5)
    const last = laneWidthOf(1, 2, false, centerWidth, innerWidth)
    // 多出的正是侧栏宽度，这就是"右边显示不全"的来源
    expect(centerWidth + last - containerWidth).toBe(innerWidth - containerWidth)
  })
})

describe('拖拽调整栏宽', () => {
  it('比例被夹在 MIN/MAX 之间，越界不生效', () => {
    expect(clampPaneRatio(0.05)).toBe(MIN_PANE_RATIO)
    expect(clampPaneRatio(0.95)).toBe(MAX_PANE_RATIO)
    expect(clampPaneRatio(0.45)).toBe(0.45)
  })

  it('默认比例 0.5（与修复前的居中等分一致）', () => {
    expect(DEFAULT_PANE_RATIO).toBe(0.5)
  })

  it('ratioFromPointer 把指针位置换算成比例（按容器左边界与宽度）', () => {
    // 容器从 x=100 起、宽 800；指针落在 x=500 → (500-100)/800 = 0.5
    expect(ratioFromPointer(100, 800, 500)).toBe(0.5)
    // x=420 → (420-100)/800 = 0.4（落在夹取区间内，能原值返回）
    expect(ratioFromPointer(100, 800, 420)).toBe(0.4)
    // 拖到最小边界外被夹到 30%，不会把中栏拖没
    expect(ratioFromPointer(100, 800, 140)).toBe(MIN_PANE_RATIO)
  })

  it('容器宽度为 0 时返回默认比例（挂载首帧安全）', () => {
    expect(ratioFromPointer(0, 0, 400)).toBe(DEFAULT_PANE_RATIO)
  })
})
