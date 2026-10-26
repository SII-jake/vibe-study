import { describe, expect, it } from 'vitest'
import { buildChatMessages } from '../src/domain/chat'
import { addChildNode, breadcrumb, createRootNode } from '../src/domain/tree'

describe('buildChatMessages', () => {
  const root = createRootNode({ id: 'root', topic: '什么是复利', createdAt: 1 })
  const child = addChildNode({
    id: 'child',
    parentId: 'root',
    anchor: { messageId: 'a1', fragmentIndex: 1, text: '时间的影响远大于收益率' },
    question: '有反例吗',
    createdAt: 2,
  })

  it('首条为系统消息', () => {
    const messages = buildChatMessages(breadcrumb([root, child], 'child'))
    expect(messages[0]?.role).toBe('system')
  })

  it('父节点对话按时间顺序进入上下文', () => {
    const messages = buildChatMessages(breadcrumb([root, child], 'child'))
    expect(messages.map((m) => m.role)).toEqual(['system', 'user', 'user'])
    expect(messages[1]?.content).toBe('什么是复利')
  })

  it('子节点问题附带被选中的原文', () => {
    const messages = buildChatMessages(breadcrumb([root, child], 'child'))
    expect(messages[2]?.content).toContain('时间的影响远大于收益率')
    expect(messages[2]?.content).toContain('有反例吗')
  })

  it('系统消息说明只在锚点处作答', () => {
    const messages = buildChatMessages(breadcrumb([root, child], 'child'))
    expect(messages[0]?.content).toContain('锚点')
  })
})
