// @vitest-environment jsdom
// 选择守卫（web 基座移植）：焦点/选区在可编辑元素时放行系统菜单，否则由壳拦截
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { installSelectionGuard, isEditableElement } from '../web/src/services/selectionGuard'

describe('isEditableElement', () => {
  it('input/textarea 可编辑；普通 div 不可编辑；contenteditable 内可编辑', () => {
    const input = document.createElement('input')
    const textarea = document.createElement('textarea')
    const div = document.createElement('div')
    const editable = document.createElement('div')
    editable.setAttribute('contenteditable', 'true') // jsdom 的 IDL 赋值不反射 attribute，须用 setAttribute
    const inner = document.createElement('span')
    editable.append(inner)
    expect(isEditableElement(input)).toBe(true)
    expect(isEditableElement(textarea)).toBe(true)
    expect(isEditableElement(div)).toBe(false)
    expect(isEditableElement(inner)).toBe(true)
    expect(isEditableElement(null)).toBe(false)
  })

  it('disabled 的 input 不算可编辑', () => {
    const input = document.createElement('input')
    input.disabled = true
    expect(isEditableElement(input)).toBe(false)
  })
})

describe('installSelectionGuard（VibeSelectionGuard 桥回写）', () => {
  beforeEach(() => {
    ;(window as typeof window & { VibeSelectionGuard?: { setEditableFocused: (f: boolean) => void; calls: boolean[] } }).VibeSelectionGuard = {
      calls: [],
      setEditableFocused(focused: boolean) { (this as { calls: boolean[] }).calls.push(focused) },
    }
  })
  afterEach(() => {
    delete (window as typeof window & { VibeSelectionGuard?: unknown }).VibeSelectionGuard
  })

  it('聚焦输入框回写 true，失焦回写 false', async () => {
    const dispose = installSelectionGuard()
    const input = document.createElement('input')
    document.body.append(input)
    input.focus()
    const bridge = (window as never as { VibeSelectionGuard: { calls: boolean[] } }).VibeSelectionGuard
    expect(bridge.calls.at(-1)).toBe(true)
    input.blur()
    document.body.focus()
    // 实现的 focusout 是 setTimeout(0) 延后一拍回写，等它落定再断言
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(bridge.calls.at(-1)).toBe(false)
    dispose()
    input.remove()
  })

  it('无桥环境静默（浏览器桌面端不报错）', () => {
    delete (window as never as { VibeSelectionGuard?: unknown }).VibeSelectionGuard
    const dispose = installSelectionGuard()
    const input = document.createElement('input')
    document.body.append(input)
    expect(() => { input.focus(); input.blur() }).not.toThrow()
    dispose()
    input.remove()
  })
})
