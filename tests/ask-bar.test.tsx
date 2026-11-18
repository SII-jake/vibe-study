// @vitest-environment jsdom
/**
 * 移动端选择追问操作条：长按拖选 → 抬手（停顿后）浮现操作条（追问/复制）→
 * 点追问才打开输入浮层；点复制写剪贴板并收起。
 * 关键约束：选择过程中（拖移动中）绝不弹层——这是"长按滑选"可用性的根。
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AskActionBar } from '../web/src/components/messages/AskActionBar'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root
beforeEach(async () => {
  // jsdom 默认 en-US，按 zh-CN 渲染文案断言
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

describe('AskActionBar（选择后操作条）', () => {
  it('渲染 追问 与 复制 两个操作', () => {
    act(() => {
      root.render(<AskActionBar rect={{ top: 200, left: 100, width: 88, height: 24, bottom: 224, right: 188 } as DOMRect} anchorText="某段原文" onAsk={() => {}} onCopied={() => {}} />)
    })
    const buttons = [...container.querySelectorAll('button')].map((b) => b.textContent)
    expect(buttons).toContain('追问')
    expect(buttons).toContain('复制')
  })

  it('点追问带原文进入回调（由外层决定打开输入浮层）', () => {
    const onAsk = vi.fn()
    act(() => {
      root.render(<AskActionBar rect={{ top: 200, left: 100, width: 88, height: 24, bottom: 224, right: 188 } as DOMRect} anchorText="选中这句" onAsk={onAsk} onCopied={() => {}} />)
    })
    const askBtn = [...container.querySelectorAll('button')].find((b) => b.textContent === '追问') as HTMLButtonElement
    act(() => { askBtn.click() })
    expect(onAsk).toHaveBeenCalledTimes(1)
  })

  it('点复制写剪贴板并回调收起', async () => {
    const written: string[] = []
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: (t: string) => { written.push(t); return Promise.resolve() } },
      configurable: true,
    })
    const onCopied = vi.fn()
    act(() => {
      root.render(<AskActionBar rect={{ top: 200, left: 100, width: 88, height: 24, bottom: 224, right: 188 } as DOMRect} anchorText="要复制的原文" onAsk={() => {}} onCopied={onCopied} />)
    })
    const copyBtn = [...container.querySelectorAll('button')].find((b) => b.textContent === '复制') as HTMLButtonElement
    await act(async () => { copyBtn.click(); await Promise.resolve() })
    expect(written).toEqual(['要复制的原文'])
    expect(onCopied).toHaveBeenCalledTimes(1)
  })
})
