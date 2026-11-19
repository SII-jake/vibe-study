// 面板定位自适应守护（用户手机实测两次：左半边飞出→撤 transform 后仍缺一小半）：
// 钳位计算必须用与 CSS 同款的实际宽度 min(360, vw-32)，不得写死 360——
// 写死会让窄屏上钳位上限 innerWidth-360-8 失真，面板右缘或左缘出屏。
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { askPopoverPosition } from '../web/src/components/messages/askPopoverPosition'

describe('面板样式宽度公式与 JS 定位尺同源（手机实测三轮的防线）', () => {
  it('AskPopover.module.css 基础宽度是 min(360px, calc(100vw - 32px))，不再是 60vw', () => {
    const css = readFileSync('web/src/components/messages/AskPopover.module.css', 'utf8')
    expect(css).toContain('width: min(360px, calc(100vw - 32px))')
    expect(css).not.toContain('60vw')
  })
})

describe('askPopoverPosition 视口自适应', () => {
  it('窄屏（390px）左缘选区时面板完整落在视口内', () => {
    const p = askPopoverPosition({ left: 4, top: 400, bottom: 424, width: 200 }, 390, 844)
    const width = Math.min(360, 390 - 32)
    expect(p.left).toBeGreaterThanOrEqual(8)
    expect(p.left + width).toBeLessThanOrEqual(390 - 8)
  })

  it('窄屏选区居中时钳位上限用实际宽度而非估死的 360', () => {
    const p = askPopoverPosition({ left: 150, top: 400, bottom: 424, width: 100 }, 390, 844)
    expect(p.left + Math.min(360, 390 - 32)).toBeLessThanOrEqual(390 - 8)
  })

  it('桌面宽屏选区靠右时也不出屏', () => {
    const p = askPopoverPosition({ left: 1300, top: 300, bottom: 324, width: 90 }, 1400, 900)
    expect(p.left).toBeLessThanOrEqual(1400 - 360 - 8)
    expect(p.left).toBeGreaterThanOrEqual(8)
  })

  it('下方放不下时翻到选区上方且不越顶', () => {
    const p = askPopoverPosition({ left: 100, top: 800, bottom: 830, width: 80 }, 390, 844)
    expect(p.top).toBeGreaterThanOrEqual(8)
    expect(p.top).toBeLessThan(830)
  })
})
