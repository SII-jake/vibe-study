import { describe, expect, it } from 'vitest'
import {
  addChildNode,
  breadcrumb,
  childrenByFragment,
  createRootNode,
  descendantCount,
  latestAnswer,
} from '../src/domain/tree'

const root = createRootNode({
  id: 'root',
  topic: '什么是复利',
  createdAt: 1,
})

const child = addChildNode({
  id: 'child',
  parentId: 'root',
  anchor: { messageId: 'a1', fragmentIndex: 1, text: '时间的影响' },
  question: '有反例吗',
  createdAt: 2,
})

const grandChild = addChildNode({
  id: 'grand',
  parentId: 'child',
  anchor: { messageId: 'a2', fragmentIndex: 0, text: '极端情况' },
  question: '什么算极端',
  createdAt: 3,
})

const nodes = [root, child, grandChild]

describe('createRootNode', () => {
  it('根节点没有父节点与锚点', () => {
    expect(root.parentId).toBeNull()
    expect(root.anchor).toBeNull()
  })

  it('根节点以主题作为用户消息', () => {
    expect(root.messages).toHaveLength(1)
    expect(root.messages[0]).toMatchObject({ role: 'user', content: '什么是复利' })
  })
})

describe('addChildNode', () => {
  it('子节点保留锚点并以问题作为首条消息', () => {
    expect(child.parentId).toBe('root')
    expect(child.anchor?.text).toBe('时间的影响')
    expect(child.messages[0]).toMatchObject({ role: 'user', content: '有反例吗' })
  })
})

describe('breadcrumb', () => {
  it('从根到当前节点按层级返回', () => {
    expect(breadcrumb(nodes, 'grand').map((n) => n.id)).toEqual(['root', 'child', 'grand'])
  })

  it('节点 id 不存在时返回空数组', () => {
    expect(breadcrumb(nodes, 'missing')).toEqual([])
  })
})

describe('childrenByFragment', () => {
  it('按锚点所在片段归组子节点', () => {
    const grouped = childrenByFragment(nodes, 'root')
    expect(grouped.get(1)?.map((n) => n.id)).toEqual(['child'])
  })

  it('传 messageId 时只归组锚定到该条回答的子节点', () => {
    const other = addChildNode({
      id: 'other',
      parentId: 'root',
      anchor: { messageId: 'root-m2', fragmentIndex: 1, text: '另一轮' },
      question: '第二轮的问法',
      createdAt: 4,
    })
    const withOther = [...nodes, other]
    expect(childrenByFragment(withOther, 'root', 'root-m2').get(1)?.map((n) => n.id)).toEqual([
      'other',
    ])
    expect(childrenByFragment(withOther, 'root', 'root-m1').get(1)).toBeUndefined()
  })
})

describe('descendantCount', () => {
  it('统计全部后代数量', () => {
    expect(descendantCount(nodes, 'root')).toBe(2)
    expect(descendantCount(nodes, 'child')).toBe(1)
    expect(descendantCount(nodes, 'grand')).toBe(0)
  })
})

describe('latestAnswer', () => {
  it('没有回答时返回 null', () => {
    expect(latestAnswer(child)).toBeNull()
  })

  it('多条回答时取最后一条', () => {
    const answered = {
      ...child,
      messages: [
        ...child.messages,
        { id: 'a1', role: 'assistant' as const, content: '第一版', createdAt: 4 },
        { id: 'a2', role: 'assistant' as const, content: '第二版', createdAt: 5 },
      ],
    }
    expect(latestAnswer(answered)?.content).toBe('第二版')
  })
})
