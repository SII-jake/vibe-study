// @vitest-environment jsdom
// 系统选择菜单抑制：回答正文区（data-ask-text）的 contextmenu 被阻止默认行为——
// Android WebView 长按触发 ActionMode 走 contextmenu 通道，preventDefault 让菜单
// 不启动（避免壳 finish 拦截造成的"一闪而过"）；输入框/其他区域不受影响。
import { describe, expect, it } from 'vitest'
import { shouldSuppressContextMenu } from '../web/src/components/session/contextMenuGuard'

describe('shouldSuppressContextMenu', () => {
  it('目标位于回答正文（data-ask-text）内 → 抑制', () => {
    const host = document.createElement('div')
    host.setAttribute('data-ask-text', 'true')
    const inner = document.createElement('p')
    host.append(inner)
    document.body.append(host)
    expect(shouldSuppressContextMenu(inner)).toBe(true)
    host.remove()
  })

  it('目标在正文之外 / 输入框里 → 不抑制（系统粘贴菜单保留）', () => {
    const div = document.createElement('div')
    const textarea = document.createElement('textarea')
    document.body.append(div, textarea)
    expect(shouldSuppressContextMenu(div)).toBe(false)
    expect(shouldSuppressContextMenu(textarea)).toBe(false)
    expect(shouldSuppressContextMenu(null)).toBe(false)
    div.remove()
    textarea.remove()
  })
})

describe('contextmenu 事件接入后的真实行为', () => {
  it('正文内 contextmenu 的 defaultPrevented 为 true，正文外为 false', () => {
    const host = document.createElement('div')
    host.setAttribute('data-ask-text', 'true')
    const inner = document.createElement('p')
    host.append(inner)
    const outside = document.createElement('div')
    document.body.append(host, outside)

    const handler = (e: Event) => {
      const target = e.target instanceof Element ? e.target : null
      if (shouldSuppressContextMenu(target)) e.preventDefault()
    }
    document.addEventListener('contextmenu', handler)

    const insideEvent = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    inner.dispatchEvent(insideEvent)
    expect(insideEvent.defaultPrevented).toBe(true)

    const outsideEvent = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    outside.dispatchEvent(outsideEvent)
    expect(outsideEvent.defaultPrevented).toBe(false)

    document.removeEventListener('contextmenu', handler)
    host.remove()
    outside.remove()
  })
})
