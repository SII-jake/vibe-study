// @vitest-environment jsdom
// 正文长按选择时：系统选择菜单与我们的「就这段提问」同时弹出（真实手机反馈）。
// Web 层没有 API 屏蔽系统 ActionMode，须由原生壳拦截；本模块负责把
// 「焦点是否在可编辑元素」同步给原生层——正文区屏蔽系统菜单，
// 输入框/提问框里的粘贴菜单必须保留。
import { beforeEach, describe, expect, it } from 'vitest'
import { installSelectionGuard, isEditableElement } from '../src/ui/selection-guard'

describe('isEditableElement', () => {
  it('输入框、文本域、下拉框算可编辑', () => {
    for (const tag of ['input', 'textarea', 'select']) {
      expect(isEditableElement(document.createElement(tag))).toBe(true)
    }
  })

  it('contenteditable 元素及其后代算可编辑', () => {
    const host = document.createElement('div')
    host.setAttribute('contenteditable', 'true')
    const child = document.createElement('span')
    host.append(child)
    expect(isEditableElement(host)).toBe(true)
    expect(isEditableElement(child)).toBe(true)
  })

  it('普通正文元素与 null 不算可编辑', () => {
    expect(isEditableElement(document.createElement('p'))).toBe(false)
    expect(isEditableElement(null)).toBe(false)
  })
})

describe('installSelectionGuard', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    delete window.VibeSelectionGuard
  })

  it('焦点进入输入框时通知原生层可编辑=true，离开后为 false', async () => {
    const calls = []
    window.VibeSelectionGuard = { setEditableFocused: (v) => calls.push(v) }
    installSelectionGuard()

    const input = document.createElement('input')
    const para = document.createElement('p')
    para.tabIndex = -1
    document.body.append(input, para)

    input.focus()
    expect(calls.at(-1)).toBe(true)

    para.focus() // 触发 focusout → 延后一拍重检
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(calls.at(-1)).toBe(false)
  })

  it('浏览器环境没有原生接口时静默跳过，不报错', () => {
    expect(() => installSelectionGuard()).not.toThrow()
    const input = document.createElement('input')
    document.body.append(input)
    expect(() => input.focus()).not.toThrow()
  })

  it('输入框持焦但在正文里选区时，按选区位置判定为不可编辑（原生层熄系统菜单）', async () => {
    const calls = []
    window.VibeSelectionGuard = { setEditableFocused: (v) => calls.push(v) }
    installSelectionGuard()

    const input = document.createElement('input')
    const para = document.createElement('p')
    para.textContent = '正文段落'
    document.body.append(input, para)

    input.focus()
    expect(calls.at(-1)).toBe(true)

    // 在正文段落里拉出选区；jsdom 不自动派发 selectionchange，手动补发
    window.getSelection().setBaseAndExtent(para.firstChild, 0, para.firstChild, 3)
    document.dispatchEvent(new Event('selectionchange'))
    expect(calls.at(-1)).toBe(false)

    // 选区折叠后回到焦点口径
    window.getSelection().removeAllRanges()
    document.dispatchEvent(new Event('selectionchange'))
    expect(calls.at(-1)).toBe(true)
  })
})
