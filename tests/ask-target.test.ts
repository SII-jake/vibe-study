import { describe, expect, it } from 'vitest'
import { addChildNode, createRootNode } from '../src/domain/tree'
import { toAskInput } from '../src/ui/ask-target'

const root = createRootNode({ id: 'root', topic: '什么是复利', createdAt: 1 })
const answered = {
  ...root,
  messages: [
    ...root.messages,
    { id: 'root-a1', role: 'assistant' as const, content: '第一版回答', createdAt: 2 },
    { id: 'root-a2', role: 'assistant' as const, content: '第二版回答', createdAt: 3 },
  ],
}

const reading = { fragmentIndex: 2, text: '利息本身也产生利息' }

describe('toAskInput', () => {
  it('把选区与问题组装成开分支的输入，父节点取当前节点', () => {
    const input = toAskInput(answered, { ...reading, messageId: 'root-a1' }, '那和单利比呢？')
    expect(input).toEqual({
      parentId: 'root',
      messageId: 'root-a1',
      fragmentIndex: 2,
      text: '利息本身也产生利息',
      question: '那和单利比呢？',
    })
  })

  it('选区没记录消息 id 时，锚定到最新那条回答', () => {
    // 同节点多轮回答时，落到旧轮次会让分支挂错地方，所以必须取最新一条
    expect(toAskInput(answered, reading, 'q').messageId).toBe('root-a2')
  })

  it('节点还没有回答时 messageId 为空串，不抛错', () => {
    expect(toAskInput(root, reading, 'q').messageId).toBe('')
  })

  it('不改动传入的节点与选区对象', () => {
    const readingCopy = { ...reading }
    toAskInput(answered, readingCopy, 'q')
    expect(readingCopy).toEqual(reading)
    expect(answered.messages).toHaveLength(3)
  })

  it('子节点同样适用，父节点取该子节点自身', () => {
    const child = addChildNode({
      id: 'child',
      parentId: 'root',
      anchor: { messageId: 'root-a2', fragmentIndex: 0, text: '利息' },
      question: '利息怎么算',
      createdAt: 4,
    })
    expect(toAskInput(child, reading, 'q').parentId).toBe('child')
  })
})
