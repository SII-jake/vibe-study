import { describe, expect, it } from 'vitest'
import { addChildNode, createRootNode } from '../src/domain/tree'
import {
  appendAnswer,
  appendUserMessage,
  clearLastAnswer,
  removeSubtree,
} from '../src/domain/tree-ops'

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

describe('appendUserMessage', () => {
  it('在同节点追加一条用户消息，不新增节点', () => {
    const continued = appendUserMessage(nodes, 'child', '那这段话反过来怎么理解', 4)
    expect(continued).toHaveLength(3)
    expect(continued[1]?.messages.map((m) => m.role)).toEqual(['user', 'user'])
    expect(continued[1]?.messages[1]?.content).toBe('那这段话反过来怎么理解')
    expect(continued[1]?.anchor?.text).toBe('利息')
  })

  it('节点不存在时原样返回', () => {
    expect(appendUserMessage(nodes, 'missing', 'x', 4)).toEqual(nodes)
  })
})

describe('clearLastAnswer', () => {
  it('多轮消息只删掉最后一条回答，保留其它轮次', () => {
    const twoRounds = appendAnswer(
      appendUserMessage(appendAnswer(nodes, 'child', '第一轮回答', 3), 'child', '追问', 4),
      'child',
      '第二轮回答',
      5,
    )
    const cleared = clearLastAnswer(twoRounds, 'child')
    expect(cleared[1]?.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user'])
    expect(cleared[1]?.messages[1]?.content).toBe('第一轮回答')
  })

  it('没有回答时不动', () => {
    expect(clearLastAnswer(nodes, 'child')).toEqual(nodes)
  })
})
