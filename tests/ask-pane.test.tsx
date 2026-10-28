// @vitest-environment jsdom
// 右栏提问框：选中一段后的提问不再从底部弹窗出现，而是在右栏就地输入。
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AskPane } from '../src/ui/AskPane'

// React 18 的 act 需要这个标记，否则会告警且不批处理状态更新
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

function render(node: React.ReactElement) {
  act(() => root.render(node))
}

/** React 受控输入必须走原生 setter，直接改 value 不会触发 onChange。 */
function type(el: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
  setter?.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('AskPane', () => {
  it('展示被选中的原文，让用户知道自己在问哪一段', () => {
    render(<AskPane anchorText="利息本身也产生利息" onSubmit={() => {}} onCancel={() => {}} />)
    expect(container.textContent).toContain('利息本身也产生利息')
    expect(container.textContent).toContain('就这段提问')
  })

  it('输入后提交，传出去掉首尾空白的问题', () => {
    const onSubmit = vi.fn()
    render(<AskPane anchorText="原文" onSubmit={onSubmit} onCancel={() => {}} />)

    const textarea = container.querySelector('textarea')!
    act(() => type(textarea, '  那和单利比呢？  '))

    const submit = [...container.querySelectorAll('button')].find((b) => b.textContent === '提问')!
    act(() => submit.click())

    expect(onSubmit).toHaveBeenCalledWith('那和单利比呢？')
  })

  it('问题为空时提交按钮不可用', () => {
    render(<AskPane anchorText="原文" onSubmit={() => {}} onCancel={() => {}} />)
    const submit = [...container.querySelectorAll('button')].find((b) => b.textContent === '提问')!
    expect(submit.disabled).toBe(true)
  })

  it('只有空白的问题同样算空，不提交', () => {
    const onSubmit = vi.fn()
    render(<AskPane anchorText="原文" onSubmit={onSubmit} onCancel={() => {}} />)
    const textarea = container.querySelector('textarea')!
    act(() => type(textarea, '   '))
    const submit = [...container.querySelectorAll('button')].find((b) => b.textContent === '提问')!
    expect(submit.disabled).toBe(true)
    act(() => submit.click())
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('取消时回调 onCancel，不提交问题', () => {
    const onSubmit = vi.fn()
    const onCancel = vi.fn()
    render(<AskPane anchorText="原文" onSubmit={onSubmit} onCancel={onCancel} />)
    const cancel = [...container.querySelectorAll('button')].find((b) => b.textContent === '取消')!
    act(() => cancel.click())
    expect(onCancel).toHaveBeenCalled()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('打开即聚焦输入框，省一次点击', () => {
    render(<AskPane anchorText="原文" onSubmit={() => {}} onCancel={() => {}} />)
    expect(document.activeElement).toBe(container.querySelector('textarea'))
  })
})
