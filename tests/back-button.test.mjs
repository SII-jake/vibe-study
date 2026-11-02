// @vitest-environment jsdom
/** Android 返回键测试：判定逻辑 + hook 与事件源的接线。 */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useBackButton, resolveBackPress, DOUBLE_BACK_EXIT_MS } from '../src/app/use-back-button'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let container
let root

beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('resolveBackPress', () => {
  it('非 root（node 页）按返回：应用内回退，不退出', () => {
    expect(resolveBackPress({ kind: 'node', nodeId: 'n1' }, 0, 10_000)).toEqual({
      action: 'back',
    })
  })

  it('非 root（设置页）按返回：应用内回退，不退出', () => {
    expect(resolveBackPress({ kind: 'settings' }, 0, 10_000)).toEqual({ action: 'back' })
  })

  it('root 首次按返回：提示再按一次退出，不直接退出', () => {
    expect(resolveBackPress({ kind: 'topics' }, 0, 10_000)).toEqual({ action: 'prompt' })
  })

  it('root 在间隔内第二次按返回：真正退出', () => {
    const firstAt = 100_000
    const secondAt = firstAt + DOUBLE_BACK_EXIT_MS - 1
    expect(resolveBackPress({ kind: 'topics' }, firstAt, secondAt)).toEqual({ action: 'exit' })
  })

  it('root 两次按下间隔超时：重新视为首次，提示而非退出', () => {
    const firstAt = 100_000
    const secondAt = firstAt + DOUBLE_BACK_EXIT_MS + 1
    expect(resolveBackPress({ kind: 'topics' }, firstAt, secondAt)).toEqual({ action: 'prompt' })
  })

  it('非 root 回退后双击计时复位：回 root 第一次按仍是提示', () => {
    // 在 node 页按过一次（lastPressAt 复位语义由调用方保证传入 0）。
    expect(resolveBackPress({ kind: 'topics' }, 0, 500)).toEqual({ action: 'prompt' })
  })
})

/** 捕获 backButton 回调的事件源替身，语义与 Capacitor App 插件一致。 */
function makeSource() {
  const listeners = []
  return {
    addListener(cb) {
      listeners.push(cb)
      return {
        remove: () => {
          const idx = listeners.indexOf(cb)
          if (idx >= 0) listeners.splice(idx, 1)
        },
      }
    },
    exitApp: vi.fn(),
    press() {
      for (const cb of [...listeners]) cb()
    },
    listenerCount: () => listeners.length,
  }
}

function Probe(props) {
  useBackButton(props, props.source)
  return null
}

describe('useBackButton（事件源注入）', () => {
  it('非 root 按返回：调用 goBack，不退出', async () => {
    const source = makeSource()
    const goBack = vi.fn()
    const showExitPrompt = vi.fn()
    await act(async () => {
      root.render(
        createElement(Probe, { route: { kind: 'node', nodeId: 'n1' }, goBack, showExitPrompt, source }),
      )
    })
    act(() => source.press())
    expect(goBack).toHaveBeenCalledTimes(1)
    expect(source.exitApp).not.toHaveBeenCalled()
    expect(showExitPrompt).not.toHaveBeenCalled()
  })

  it('root 首次按返回：提示，不退出；间隔内再按退出', async () => {
    const source = makeSource()
    const goBack = vi.fn()
    const showExitPrompt = vi.fn()
    await act(async () => {
      root.render(
        createElement(Probe, { route: { kind: 'topics' }, goBack, showExitPrompt, source }),
      )
    })
    act(() => source.press())
    expect(showExitPrompt).toHaveBeenCalledTimes(1)
    expect(source.exitApp).not.toHaveBeenCalled()
    act(() => source.press())
    expect(source.exitApp).toHaveBeenCalledTimes(1)
    expect(goBack).not.toHaveBeenCalled()
  })

  it('路由变化后用最新 handler：root 按过一次再下到 node，按返回走 goBack', async () => {
    const source = makeSource()
    const goBack = vi.fn()
    const showExitPrompt = vi.fn()
    await act(async () => {
      root.render(
        createElement(Probe, { route: { kind: 'topics' }, goBack, showExitPrompt, source }),
      )
    })
    act(() => source.press())
    expect(showExitPrompt).toHaveBeenCalledTimes(1)
    await act(async () => {
      root.render(
        createElement(Probe, {
          route: { kind: 'node', nodeId: 'n1' },
          goBack,
          showExitPrompt,
          source,
        }),
      )
    })
    act(() => source.press())
    expect(goBack).toHaveBeenCalledTimes(1)
    expect(source.exitApp).not.toHaveBeenCalled()
    // 回退后计时复位，换 handler 的过程不残留「上次按过」的状态
    await act(async () => {
      root.render(
        createElement(Probe, { route: { kind: 'topics' }, goBack, showExitPrompt, source }),
      )
    })
    act(() => source.press())
    expect(showExitPrompt).toHaveBeenCalledTimes(2)
    expect(source.exitApp).not.toHaveBeenCalled()
  })

  it('卸载后移除监听，不再响应返回键', async () => {
    const source = makeSource()
    const goBack = vi.fn()
    await act(async () => {
      root.render(
        createElement(Probe, { route: { kind: 'node', nodeId: 'n1' }, goBack, source }),
      )
    })
    expect(source.listenerCount()).toBe(1)
    act(() => root.unmount())
    expect(source.listenerCount()).toBe(0)
    act(() => source.press())
    expect(goBack).not.toHaveBeenCalled()
  })
})
