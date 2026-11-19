// @vitest-environment jsdom
// AskPane 起草组件（decisions/2026-11-19 §二.4 右栏起草位）：
// 顶钉"就这段提问"+锚点原文引用；Enter 发送 / Shift+Enter 换行 /
// IME 组合中回车不发送（user 手机聊天实测基线语义）。
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AskPane } from '../web/src/components/session/AskPane.js'

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

describe('AskPane 右栏起草位', () => {
  it('顶部钉"就这段提问"与锚点原文引用', () => {
    act(() => {
      root.render(<AskPane anchorText="某段被选中的原文" onSubmit={() => {}} onCancel={() => {}} />)
    })
    const text = container.textContent ?? ''
    expect(text).toContain('就这段提问')
    expect(text).toContain('某段被选中的原文')
  })

  it('Enter 提交（trim 后非空才发；Shift+Enter 不发）', () => {
    const onSubmit = vi.fn()
    act(() => {
      root.render(<AskPane anchorText="原文" onSubmit={onSubmit} onCancel={() => {}} />)
    })
    const input = container.querySelector('textarea')!
    act(() => {
      // React 受控输入
      const native = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!
      native.call(input, '  就问这段  ')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    })
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit).toHaveBeenCalledWith('就问这段')
  })

  it('空白输入 Enter / 点击提问按钮都不发', () => {
    const onSubmit = vi.fn()
    act(() => {
      root.render(<AskPane anchorText="原文" onSubmit={onSubmit} onCancel={() => {}} />)
    })
    const submitBtn = [...container.querySelectorAll('button')].find((b) => b.textContent?.includes('提问'))!
    expect((submitBtn as HTMLButtonElement).disabled).toBe(true)
    act(() => {
      const input = container.querySelector('textarea')!
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('IME 组合中（isComposing）回车不发送——中文输入法确认合成不应触发提交', () => {
    const onSubmit = vi.fn()
    act(() => {
      root.render(<AskPane anchorText="原文" onSubmit={onSubmit} onCancel={() => {}} />)
    })
    const input = container.querySelector('textarea')!
    act(() => {
      const native = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!
      native.call(input, '中文在写')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const composing = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
    Object.defineProperty(composing, 'isComposing', { value: true })
    act(() => { input.dispatchEvent(composing) })
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('Escape 与"取消"按钮走 onCancel', () => {
    const onCancel = vi.fn()
    act(() => {
      root.render(<AskPane anchorText="原文" onSubmit={() => {}} onCancel={onCancel} />)
    })
    const cancelBtn = [...container.querySelectorAll('button')].find((b) => b.textContent?.includes('取消'))!
    act(() => { (cancelBtn as HTMLButtonElement).click() })
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
