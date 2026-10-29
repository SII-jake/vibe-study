// @vitest-environment jsdom
// 左栏：顶部「vibe study」标题与「＋ 新会话」按钮是同一条回到起始页的入口。
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionList } from '../src/ui/SessionList'
import { createRootNode } from '../src/domain/tree'
import type { LearnData } from '../src/app/store'

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

function makeData(nodes: LearnData['nodes']): LearnData {
  return {
    ready: true,
    nodes,
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
  }
}

const topic = createRootNode({
  id: 't1',
  topic: '什么是复利？',
  createdAt: 1,
})

function renderList(onNewSession = () => {}) {
  act(() =>
    root.render(
      <SessionList
        data={makeData([topic])}
        activeRootId={null}
        onOpen={() => {}}
        onNewSession={onNewSession}
        onOpenSettings={() => {}}
      />,
    ),
  )
}

describe('SessionList', () => {
  it('顶部「vibe study」标题可以点击，效果与「＋ 新会话」相同：都走 onNewSession', () => {
    const onNewSession = vi.fn()
    renderList(onNewSession)

    const brand = container.querySelector('.session-head [data-brand]') as HTMLElement
    expect(brand).not.toBeNull()
    act(() => brand.click())
    expect(onNewSession).toHaveBeenCalledTimes(1)

    const newBtn = container.querySelector('.new-session-btn') as HTMLButtonElement
    act(() => newBtn.click())
    expect(onNewSession).toHaveBeenCalledTimes(2)
  })

  it('标题是可聚焦的按钮语义，而不是纯文本', () => {
    renderList()
    const h1 = container.querySelector('.session-head h1')!
    // 纯 h1 文本拿不到键盘焦点；包装成按钮才能 Tab 到并触发
    const activatable = h1.closest('button') ?? h1.querySelector('button')
    expect(activatable, '标题应包在 button 里').not.toBeNull()
    expect(activatable!.textContent).toContain('vibe study')
  })
})
