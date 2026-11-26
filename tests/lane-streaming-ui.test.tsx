// @vitest-environment jsdom
// 输入框的「停止/发送」原来按会话判定（Object.hasOwn(state.streaming, sessionId)），
// store 改成按 lane 建键后这层判定就错了：主线在生成时，同会话追问分支的输入框
// 也会显示停止按钮，点它停的还是主线。本文件钉住「按 lane 判定」的接线契约。
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// web/src/app/viewport.ts 在模块顶层就调 window.matchMedia——必须在 import 前桩好，
// 否则 ChatInput 的 import 链直接抛 TypeError（jsdom 无此 API）。
vi.hoisted(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false, // 桌面：输入框不转移动端分支
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      onchange: null,
      dispatchEvent: () => false,
    }),
  })
  ;(globalThis as Record<string, unknown>).ResizeObserver =
    (globalThis as Record<string, unknown>).ResizeObserver ??
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
})

vi.mock('../web/src/services/api/client.js', () => ({
  API_ORIGIN: 'http://test.local',
  streamMessage: vi.fn(async function* () {}),
  request: vi.fn(async () => new Response()),
  verifyApiKey: vi.fn(async () => {}),
  uploadFile: vi.fn(async () => ({ id: 'f1' })),
  deleteFile: vi.fn(async () => {}),
  ApiError: class ApiError extends Error {},
}))
vi.mock('../web/src/services/chat/db.js', () => ({
  saveSession: vi.fn(async () => {}),
  loadSession: vi.fn(async () => undefined),
  loadAllSessions: vi.fn(async () => []),
  loadSessionSummaries: vi.fn(async () => []),
  deleteSession: vi.fn(async () => {}),
  renameSession: vi.fn(async () => {}),
  saveFiles: vi.fn(async () => {}),
  loadFile: vi.fn(async () => undefined),
  clearStaging: vi.fn(async () => {}),
  addStagingSession: vi.fn(async () => {}),
  saveStagingFiles: vi.fn(async () => {}),
  updateStagingFileTypes: vi.fn(async () => {}),
  commitStaging: vi.fn(async () => []),
  reportStorageError: vi.fn(() => () => {}),
}))

const { ChatInput } = await import('../web/src/components/chatInput/ChatInput.js')

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

/** 断言用的两个按钮名（固定中文，不依赖 jsdom 的 navigator.language） */
const STOP = '停止生成'
const SEND = '发送'

const seed = async (streamingKeys: string[]) => {
  const { useChatStore } = await import('../web/src/services/chat/store.js')
  const { useSettings } = await import('../web/src/services/settings.js')
  const controllers = Object.fromEntries(streamingKeys.map((key) => [key, new AbortController()]))
  useSettings.setState({ locale: 'zh-CN' })
  useChatStore.setState({
    ready: true,
    importingHistory: false,
    sessions: [],
    sessionCache: {},
    activeId: null,
    streaming: controllers,
  })
}

const buttonLabels = () =>
  Array.from(container.querySelectorAll('button[aria-label]')).map((node) =>
    node.getAttribute('aria-label'),
  )

describe('输入框的停止/发送按 lane 判定', () => {
  it('主线在生成：主线输入框显示停止，追问分支输入框仍是发送', async () => {
    await seed(['s1'])
    act(() => {
      root.render(
        <div>
          <div data-main>
            <ChatInput sessionId="s1" />
          </div>
          <div data-ask>
            <ChatInput sessionId="s1" laneRootId="q1" />
          </div>
        </div>,
      )
    })
    const main = container.querySelector('[data-main]')!
    const ask = container.querySelector('[data-ask]')!
    expect(main.querySelector(`button[aria-label="${STOP}"]`)).toBeTruthy()
    expect(ask.querySelector(`button[aria-label="${STOP}"]`)).toBeNull()
    expect(ask.querySelector(`button[aria-label="${SEND}"]`)).toBeTruthy()
  })

  it('追问分支在生成：只有它显示停止，主线仍是发送', async () => {
    await seed(['s1\u0000q1'])
    act(() => {
      root.render(
        <div>
          <div data-main>
            <ChatInput sessionId="s1" />
          </div>
          <div data-ask>
            <ChatInput sessionId="s1" laneRootId="q1" />
          </div>
        </div>,
      )
    })
    const main = container.querySelector('[data-main]')!
    const ask = container.querySelector('[data-ask]')!
    expect(ask.querySelector(`button[aria-label="${STOP}"]`)).toBeTruthy()
    expect(main.querySelector(`button[aria-label="${STOP}"]`)).toBeNull()
    expect(main.querySelector(`button[aria-label="${SEND}"]`)).toBeTruthy()
    expect(buttonLabels().length).toBeGreaterThan(0)
  })
})
