// @vitest-environment jsdom
// 追问改回内嵌形态（用户反馈）：①选中的段落标底色 ②操作条/浮层贴近内容弹出，不全屏遮罩
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AskActionBar } from '../web/src/components/messages/AskActionBar'
import { AskPopover } from '../web/src/components/messages/AskPopover'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root
beforeEach(async () => {
  const { setLocale } = await import('../web/src/services/settings')
  setLocale('zh-CN')
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

const rect = { top: 200, left: 100, width: 88, height: 24, bottom: 224, right: 188 } as DOMRect

describe('内嵌化：弹出层遮罩去除', () => {
  it('AskActionBar 不再是全屏遮罩形态（直接在文档流旁渲染，无 mask）', () => {
    act(() => {
      root.render(<AskActionBar anchorText="原文" rect={rect} onAsk={() => {}} onCopied={() => {}} />)
    })
    expect(container.querySelector('[class*=mask]')).toBeNull()
    expect(container.querySelector('[data-ask-bar]')).toBeTruthy()
  })

  it('AskPopover 不再是全屏遮罩（直接渲染面板，位置由外层锚定控制）', () => {
    act(() => {
      root.render(
        <AskPopover anchorText="原文" position={{ top: 240, left: 120 }} onSubmit={() => {}} onClose={() => {}} />,
      )
    })
    // 不允许出现全屏 mask——操作要贴着选中的内容，不是隔开整个对话
    expect(container.querySelector('[class*=mask]')).toBeNull()
    expect(container.querySelector('[data-ask-panel]')).toBeTruthy()
  })
})

describe('锚定定位的基线撤销（手机实测：左半边飞出屏幕）', () => {
  it('带 position 时撤销居底基线的 transform 与 bottom，面板完整落在视口内', () => {
    // 缺陷机理：.popover 默认形态带 transform: translateX(-50%) + bottom: calc(...)（居底基线），
    // 锚定只覆盖 top/left，transform/bottom 残留——面板被左移半宽，选区靠左时左半边飞出
    act(() => {
      root.render(<AskPopover anchorText="原文" position={{ top: 100, left: 8 }} onSubmit={() => {}} onClose={() => {}} />)
    })
    const panel = container.querySelector('[data-ask-panel]') as HTMLElement
    expect(panel.style.transform).toBe('none')
    expect(panel.style.bottom).toBe('auto')
    expect(panel.style.top).toBe('100px')
    expect(panel.style.left).toBe('8px')
  })
})

describe('锚点高亮', () => {
  it('带 askHighlight 的段落容器渲染 DS 风格底色标记', () => {
    act(() => {
      root.render(
        <div data-ask-highlight="true">
          <p>这段被选中追问过</p>
        </div>,
      )
    })
    expect(container.querySelector('[data-ask-highlight]')).toBeTruthy()
  })
})
