// @vitest-environment jsdom
// 右栏里的子对话用 compact 形态渲染：不重复渲染整页头与底部追问条。
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NodePage } from '../src/ui/NodePage'
import { addChildNode } from '../src/domain/tree'
import { appendAnswer } from '../src/domain/tree-ops'
import type { LearnData } from '../src/app/store'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  window.sessionStorage.clear()
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

const rootNode = addChildNode({
  id: 'child',
  parentId: 'parent',
  anchor: { messageId: 'p-m1', fragmentIndex: 0, text: '利息本身也产生利息' },
  question: '那和单利比呢？',
  createdAt: 2,
})
const withAnswer = appendAnswer([rootNode], 'child', '单利是线性的，复利是指数的。', 3)

function render(el: React.ReactElement) {
  act(() => root.render(el))
}

describe('NodePage compact', () => {
  it('compact 不渲染整页头，但保留底部输入框', () => {
    render(
      <NodePage data={makeData(withAnswer)} nodeId="child" onNavigate={() => {}} onOpenTree={() => {}} compact />,
    )
    expect(container.querySelector('.reader-head')).toBeNull()
    // 右栏也要能继续追问，所以底部输入框必须留着
    expect(container.querySelector('.follow-bar')).not.toBeNull()
    // 正文仍在：片段渲染出来，右栏才能继续读和选字
    expect(container.querySelectorAll('.fragment').length).toBeGreaterThan(0)
  })

  it('非 compact 仍然带整页头和底部追问条', () => {
    render(
      <NodePage data={makeData(withAnswer)} nodeId="child" onNavigate={() => {}} onOpenTree={() => {}} />,
    )
    expect(container.querySelector('.reader-head')).not.toBeNull()
    expect(container.querySelector('.follow-bar')).not.toBeNull()
  })

  it('compact 仍展示锚点原文，说明这条子对话在回答哪一段', () => {
    render(
      <NodePage data={makeData(withAnswer)} nodeId="child" onNavigate={() => {}} onOpenTree={() => {}} compact />,
    )
    expect(container.textContent).toContain('利息本身也产生利息')
  })

  it('点击片段下的分支卡片走 onOpenBranch，而不是把中栏换掉', () => {
    const grand = addChildNode({
      id: 'grand',
      parentId: 'child',
      anchor: { messageId: 'child-a1', fragmentIndex: 0, text: '单利是线性的，复利是指数的。' },
      question: '指数增长有多快？',
      createdAt: 4,
    })
    const nodes = [...withAnswer, grand]
    const onNavigate = vi.fn()
    const onOpenBranch = vi.fn()
    render(
      <NodePage
        data={makeData(nodes)}
        nodeId="child"
        onNavigate={onNavigate}
        onOpenTree={() => {}}
        onOpenBranch={onOpenBranch}
        compact
      />,
    )
    const card = container.querySelector('.ask-card') as HTMLButtonElement
    expect(card).not.toBeNull()
    act(() => card.click())
    expect(onOpenBranch).toHaveBeenCalledWith('grand')
    expect(onNavigate).not.toHaveBeenCalled()
  })
})
