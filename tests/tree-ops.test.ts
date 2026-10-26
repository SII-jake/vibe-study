import { describe, expect, it } from 'vitest'
import { addChildNode, createRootNode } from '../src/domain/tree'
import { appendAnswer, clearAnswers, removeSubtree } from '../src/domain/tree-ops'

const root = createRootNode({ id: 'root', topic: '什么是复利', createdAt: 1 })
const child = addChildNode({
  id: 'child',
  parentId: 'root',
  anchor: { messageId: 'root-m1', fragmentIndex: 0, text: '利息' },
  question: '利息怎么算',
  createdAt: 2,
})
const grand = addChildNode({
  id: 'grand',
  parentId: 'child',
  anchor: { messageId: 'child-m1', fragmentIndex: 0, text: '本金' },
  question: '本金指什么',
  createdAt: 3,
})
const nodes = [root, child, grand]

describe('removeSubtree', () => {
  it('删除目标节点及其全部后代', () => {
    expect(removeSubtree(nodes, 'child').map((n) => n.id)).toEqual(['root'])
  })

  it('叶子节点删除只影响自身', () => {
    expect(removeSubtree(nodes, 'grand').map((n) => n.id)).toEqual(['root', 'child'])
  })

  it('节点 id 不存在时原样返回', () => {
    expect(removeSubtree(nodes, 'missing')).toEqual(nodes)
  })
})

describe('appendAnswer', () => {
  it('追加到消息末尾并保留提问', () => {
    const answered = appendAnswer(nodes, 'child', '回答正文', 9)
    expect(answered[1]?.messages.map((m) => m.role)).toEqual(['user', 'assistant'])
    expect(answered[1]?.messages[1]?.content).toBe('回答正文')
  })

  it('其他节点不受影响', () => {
    expect(appendAnswer(nodes, 'child', '回答正文', 9)[0]).toEqual(root)
  })
})

describe('clearAnswers', () => {
  it('只保留提问消息', () => {
    const answered = appendAnswer(nodes, 'child', '回答正文', 9)
    expect(clearAnswers(answered, 'child')[1]?.messages.map((m) => m.role)).toEqual(['user'])
  })
})
