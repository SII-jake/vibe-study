// @vitest-environment jsdom
// 手机端（窄视口）在左侧栏点「设置」：导航到设置页的同时遮罩形态的侧栏自动收起，
// 与从列表选会话的口径一致（openNode 已有的行为）；桌面宽视口不受影响。
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// 手机视口：useMediaQuery 依赖的 matchMedia 统一打桩为窄屏
vi.mock('../src/ui/use-media-query', () => ({
  useMediaQuery: () => true,
}))

vi.mock('../src/app/store', () => ({
  useLearnData: () => ({
    ready: true,
    nodes: [],
    streamingNodeId: null,
    streamingText: '',
    streamingStatus: null,
    error: null,
    health: { configured: true, model: 'm', models: [] },
    refreshHealth: () => {},
    createTopic: () => 'id',
    askAt: () => 'id',
    followUp: () => {},
    regenerate: () => {},
    remove: () => {},
    seedDemo: async () => {},
    clearError: () => {},
    stopStreaming: () => {},
  }),
}))

// 布局组件在 jsdom 里量不到宽度，给一个最小实现
vi.mock('../src/ui/use-element-width', () => ({
  useElementWidth: () => [() => {}, 375] as const,
}))

import { App } from '../src/app/App'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  window.localStorage.clear()
  window.location.hash = ''
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('窄屏侧栏选中即收起', () => {
  it('在侧栏点「设置」：hash 到设置页，且侧栏收起（遮罩退场）', () => {
    // 侧栏展开状态进入（窄屏收起是默认偏好，这里显式展开）
    window.localStorage.setItem('sidebar-collapsed', '0')
    window.location.hash = '#/settings'
    act(() => root.render(<App />))
    expect(container.querySelector('.app-sidebar')).not.toBeNull()

    act(() => (container.querySelector('[aria-label="设置"]') as HTMLButtonElement).click())

    // 还在设置页（hash 未被改动），侧栏已收起、只留 ☰ 展开按钮
    expect(window.location.hash).toBe('#/settings')
    expect(container.querySelector('.app-sidebar')).toBeNull()
    expect(container.querySelector('[aria-label="展开左侧栏"]')).not.toBeNull()
    expect(window.localStorage.getItem('sidebar-collapsed')).toBe('1')
  })
})
