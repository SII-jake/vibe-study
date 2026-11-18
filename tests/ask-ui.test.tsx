// @vitest-environment jsdom
/**
 * 选择追问 UI：选区落在回答正文时浮现追问按钮；
 * 同一回答下的多条追问并排陈列、可点进对应分支。
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AskBranches } from '../web/src/components/messages/AskBranches'
import type { Session, UserMessage } from '../web/src/services/chat/types'

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

const parentAssistant = {
  id: 'a1',
  role: 'assistant' as const,
  createdAt: 2,
  model: null,
  prefix: false,
  status: 'done' as const,
  blocks: [{ type: 'text' as const, text: '复利是利息也产生利息。' }],
}

function askChild(id: string, anchorText: string, question: string, createdAt: number): UserMessage {
  return {
    id,
    role: 'user',
    content: `你在回答中写过这段内容：\n\n> ${anchorText}\n\n我的追问：${question}`,
    files: [],
    createdAt,
    ask: { anchorText, anchorMessageId: 'a1' },
    parentId: 'a1',
  }
}

describe('AskBranches（并列分支区）', () => {
  it('同一回答下的多条追问并排陈列：锚点原文与问题都可见', () => {
    const session: Session = {
      id: 's1', title: '', createdAt: 1, updatedAt: 1,
      messages: [
        parentAssistant,
        askChild('q1', '开头这段', '能展开吗', 3),
        askChild('q2', '结尾那句', '是线性吗', 4),
      ],
    }
    act(() => {
      root.render(
        <AskBranches session={session} parentId="a1" onOpen={() => {}} />
      )
    })
    const text = container.textContent ?? ''
    expect(text).toContain('开头这段')
    expect(text).toContain('能展开吗')
    expect(text).toContain('结尾那句')
    expect(text).toContain('是线性吗')
    // 两条追问卡片同时存在（不是切换器）
    expect(container.querySelectorAll('[data-ask-card]').length).toBe(2)
  })

  it('非追问型子消息（regenerate/edit 版本）不进入分支区', () => {
    const versionMessage: UserMessage = {
      id: 'v1', role: 'user', content: '什么是复利（改）', files: [], createdAt: 3, parentId: 'a1',
    }
    const session: Session = {
      id: 's1', title: '', createdAt: 1, updatedAt: 1,
      messages: [parentAssistant, versionMessage],
    }
    act(() => {
      root.render(<AskBranches session={session} parentId="a1" onOpen={() => {}} />)
    })
    expect(container.innerHTML).toBe('')
  })

  it('点追问卡片回调对应消息 id（切到该分支）', () => {
    const session: Session = {
      id: 's1', title: '', createdAt: 1, updatedAt: 1,
      messages: [parentAssistant, askChild('q1', '开头这段', '能展开吗', 3)],
    }
    let opened = ''
    act(() => {
      root.render(<AskBranches session={session} parentId="a1" onOpen={(id) => { opened = id }} />)
    })
    const card = container.querySelector('[data-ask-card]') as HTMLButtonElement
    act(() => { card.click() })
    expect(opened).toBe('q1')
  })
})
