/**
 * 追问引子数据层：buildFragmentAskList 按父消息反查其下追问，
 * 剥出"我的追问："之后的提问本体；定位 anchorText 交渲染层精确匹配
 * （AskBranches 消息级兜底组件已于真机反馈第二轮退役——渲染层按文本
 * 挂载失败时统一沉兜底列，不再有消息级备用通道）。
 */
import { describe, expect, it } from 'vitest'
import { buildFragmentAskList } from '../web/src/components/messages/fragmentAsks'
import type { Session, UserMessage } from '../web/src/services/chat/types'

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

describe('buildFragmentAskList（追问引子反查）', () => {
  it('同一回答下的多条追问：按序反查、question 剥出系统前缀、anchorText 原样带透', () => {
    const session: Session = {
      id: 's1', title: '', createdAt: 1, updatedAt: 1,
      messages: [
        parentAssistant,
        askChild('q1', '复利', '能展开吗', 3),
        askChild('q2', '利息', '是线性吗', 4),
      ],
    }
    const list = buildFragmentAskList(session, 'a1')
    expect(list.length).toBe(2)
    expect(list[0]).toMatchObject({ rootId: 'q1', question: '能展开吗', anchorText: '复利' })
    expect(list[1]).toMatchObject({ rootId: 'q2', question: '是线性吗', anchorText: '利息' })
    // 同锚点的 branchCount：各自锚点唯一时为 1
    expect(list[0]!.branchCount).toBe(1)
  })

  it('同一段原文被追两次：branchCount 记 2（引子卡"N 条追问"口径）', () => {
    const session: Session = {
      id: 's1', title: '', createdAt: 1, updatedAt: 1,
      messages: [
        parentAssistant,
        askChild('q1', '复利', '能展开吗', 3),
        askChild('q2', '复利', '换个角度', 4),
      ],
    }
    const list = buildFragmentAskList(session, 'a1')
    expect(list.length).toBe(2)
    expect(list[0]!.branchCount).toBe(2)
    expect(list[1]!.branchCount).toBe(2)
  })

  it('非追问型子消息（regenerate/edit 版本）不进引子列表', () => {
    const versionMessage: UserMessage = {
      id: 'v1', role: 'user', content: '什么是复利（改）', files: [], createdAt: 3, parentId: 'a1',
    }
    const session: Session = {
      id: 's1', title: '', createdAt: 1, updatedAt: 1,
      messages: [parentAssistant, versionMessage],
    }
    expect(buildFragmentAskList(session, 'a1')).toEqual([])
  })
})
