// @vitest-environment jsdom
// 锚定选择操作条：位置跟随选区矩形在视口中展示，先于系统菜单 DOM 插入时序明确
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root
beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('AskActionBar 锚定', () => {
  it('锚定上报 rect（选区边界矩形），位置逻辑正确放在其上', async () => {
    const { AskActionBar } = await import('../web/src/components/messages/AskActionBar')
    const rect = { top: 200, left: 100, width: 88, height: 24, bottom: 224, right: 188 } as DOMRect
    act(() => {
      root.render(<AskActionBar anchorText="某段原文" rect={rect} onAsk={() => {}} onCopied={() => {}} />)
    })
    const bar = container.querySelector('[data-ask-bar]') as HTMLElement
    expect(bar).toBeTruthy()
    expect(bar.style.top).toBe('152px') // 200 - 48
    expect(bar.style.left).toBe('144px') // 100 + 44
  })

  it('视口边缘紧泊：靠近顶部/左侧时位置进行调整', async () => {
    const { AskActionBar } = await import('../web/src/components/messages/AskActionBar')
    // 顶部空间不够时返到选区下方
    const rectTop = { top: 20, left: 10, width: 50, height: 20, bottom: 40, right: 60 } as DOMRect
    act(() => {
      root.render(<AskActionBar anchorText="某段原文" rect={rectTop} onAsk={() => {}} onCopied={() => {}} />)
    })
    const bar = container.querySelector('[data-ask-bar]') as HTMLElement
    // top < 48 时选下放
    expect(bar.style.top).toBe('48px') // bottom 40 + 8
    // clamp 下限 EDGE_GAP(8) + BAR_HALF_WIDTH(96)：条身半宽不被视口裁切（防按钮挤成一坨）
    expect(bar.style.left).toBe('104px')
  })
})
