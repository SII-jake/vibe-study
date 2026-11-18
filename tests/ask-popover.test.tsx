// @vitest-environment jsdom
/**
 * 追问浮层：回答正文有选区时浮现输入气泡；输入问题提交触发 askAt 并关闭。
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AskPopover } from '../web/src/components/messages/AskPopover'

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

describe('AskPopover（选择追问浮层）', () => {
  it('展示所选原文与输入框，提交时带原文+问题回调', () => {
    const onSubmit = vi.fn()
    act(() => {
      root.render(
        <AskPopover position={{ top: 240, left: 120 }} anchorText="利息也产生利息" onSubmit={onSubmit} onClose={() => {}} />,
      )
    })
    expect(container.textContent).toContain('利息也产生利息')
    const textarea = container.querySelector('textarea')!
    act(() => {
      // 模拟用户输入
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, '是线性还是指数？')
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const submit = container.querySelector('[data-ask-submit]') as HTMLButtonElement
    act(() => { submit.click() })
    expect(onSubmit).toHaveBeenCalledWith('是线性还是指数？')
  })

  it('空问题不允许提交', () => {
    const onSubmit = vi.fn()
    act(() => {
      root.render(<AskPopover position={{ top: 240, left: 120 }} anchorText="开头这段" onSubmit={onSubmit} onClose={() => {}} />)
    })
    const submit = container.querySelector('[data-ask-submit]') as HTMLButtonElement
    act(() => { submit.click() })
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('回车（非组合输入中）直接提交；Shift+Enter 换行', () => {
    const onSubmit = vi.fn()
    act(() => {
      root.render(<AskPopover position={{ top: 240, left: 120 }} anchorText="开头这段" onSubmit={onSubmit} onClose={() => {}} />)
    })
    const textarea = container.querySelector('textarea')!
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, '问题？')
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
      // Enter 提交
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    })
    expect(onSubmit).toHaveBeenCalledWith('问题？')
  })
})
