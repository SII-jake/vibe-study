// 追问树导航（decisions/2026-11-25-ask-tree-navigator.md）。
// 树是派生视图：节点=追问分支的根用户消息（lane 根），子节点由
// getVisibleMessages(rootedConversation) 的 assistant 消息反查引子卡得到——
// 与右栏/引子卡同一口径，不新造遍历。
import { describe, expect, it } from 'vitest'
import {
  askTreePath,
  buildAskTree,
  flattenAskTree,
  type AskTree,
} from '../web/src/components/messages/askTree.js'
import type { Session } from '../web/src/services/chat/types.js'

const user = (
  id: string,
  parentId: string | null,
  ask?: { anchorText: string; anchorMessageId: string; title?: string },
  selectedChildId?: string,
) => ({
  id,
  role: 'user' as const,
  content: ask ? `你在回答中写过这段内容：\n\n> ${ask.anchorText}\n\n我的追问：${id} 的提问` : `${id} 的提问`,
  files: [],
  createdAt: 1,
  parentId,
  selectedChildId,
  ...(ask ? { ask } : {}),
})

const assistant = (id: string, parentId: string, text: string, selectedChildId?: string) =>
  ({
    id,
    role: 'assistant' as const,
    createdAt: 2,
    model: null,
    prefix: true,
    status: 'done' as const,
    parentId,
    selectedChildId,
    blocks: [{ type: 'text' as const, text }],
  }) as never

/** 主线 1 问 1 答；a1 下挂两条追问（q1/q2），q1 的回答下再挂一条（q3）。 */
const nestedSession = (): Session => ({
  id: 's-tree',
  title: '会话标题',
  createdAt: 1,
  updatedAt: 1,
  rootMessageId: 'u1',
  messages: [
    user('u1', null, undefined, 'a1'),
    assistant('a1', 'u1', '主线回答。'),
    user('q1', 'a1', { anchorText: '主线回答。', anchorMessageId: 'a1', title: '第一问' }, 'r1'),
    assistant('r1', 'q1', '第一答。'),
    user('q2', 'a1', { anchorText: '主线回答。', anchorMessageId: 'a1' }, 'r2'),
    assistant('r2', 'q2', '第二答。'),
    user('q3', 'r1', { anchorText: '第一答。', anchorMessageId: 'r1', title: '嵌套一问' }, 'r3'),
    assistant('r3', 'q3', '嵌套一答。'),
  ],
})

describe('buildAskTree（追问树派生）', () => {
  it('主线为根，a1 下两条追问同为第一层子节点', () => {
    const tree = buildAskTree(nestedSession(), '会话标题')
    expect(tree.root.id).toBe('u1')
    expect(tree.root.title).toBe('会话标题')
    expect(tree.root.children.map((child) => child.id)).toEqual(['q1', 'q2'])
    expect(tree.root.children.map((child) => child.depth)).toEqual([1, 1])
  })

  it('追问的回答上再追问，形成更深一层（深度按层递增）', () => {
    const tree = buildAskTree(nestedSession(), '会话标题')
    const first = tree.root.children.find((child) => child.id === 'q1')!
    expect(first.children.map((child) => child.id)).toEqual(['q3'])
    expect(first.children[0]!.depth).toBe(2)
    expect(tree.root.children.find((child) => child.id === 'q2')!.children).toEqual([])
  })

  it('节点标题用 ask.title，未生成时回退提问本体（与 lane 标题同一口径）', () => {
    const tree = buildAskTree(nestedSession(), '会话标题')
    const [first, second] = tree.root.children
    expect(first!.title).toBe('第一问')
    // q2 没有 ask.title：回退到提问本体
    expect(second!.title).toBe('q2 的提问')
  })

  it('节点带来源片段 anchorText；主线根为 null', () => {
    const tree = buildAskTree(nestedSession(), '会话标题')
    expect(tree.root.anchorText).toBeNull()
    expect(tree.root.children[0]!.anchorText).toBe('主线回答。')
  })

  it('同一段原文被追问多次：各是一条独立节点，不合并', () => {
    const tree = buildAskTree(nestedSession(), '会话标题')
    const sameAnchor = tree.root.children.filter((child) => child.anchorText === '主线回答。')
    expect(sameAnchor).toHaveLength(2)
    expect(tree.total).toBe(3)
  })

  it('无追问时只有根，total 为 0', () => {
    const session: Session = {
      id: 's-empty',
      title: '空',
      createdAt: 1,
      updatedAt: 1,
      rootMessageId: 'u1',
      messages: [user('u1', null, undefined, 'a1'), assistant('a1', 'u1', '答。')],
    }
    const tree = buildAskTree(session, '空')
    expect(tree.root.children).toEqual([])
    expect(tree.orphans).toEqual([])
    expect(tree.total).toBe(0)
  })

  it('挂载点已不在可见链上的追问收进 orphans，不从树上消失', () => {
    // a2 属于未被选中的另一个版本（u2 与 u1 同级），q9 挂在 a2 上——
    // 主线可见链走不到 a2，但这条追问记录仍在 messages 里。
    const base = nestedSession()
    const session: Session = {
      ...base,
      messages: [
        ...base.messages,
        user('u2', null, undefined, 'a2'),
        assistant('a2', 'u2', '另一版回答。'),
        user('q9', 'a2', { anchorText: '另一版回答。', anchorMessageId: 'a2' }, 'r9'),
        assistant('r9', 'q9', '沉底回答。'),
      ],
    }
    const tree = buildAskTree(session, '会话标题')
    expect(tree.orphans.map((node) => node.id)).toEqual(['q9'])
    expect(tree.total).toBe(4)
  })

  it('环形 parentId（坏数据）不会死循环', () => {
    const session: Session = {
      id: 's-cycle',
      title: '坏数据',
      createdAt: 1,
      updatedAt: 1,
      rootMessageId: 'u1',
      messages: [
        user('u1', 'a1', undefined, 'a1'),
        assistant('a1', 'u1', '答。', 'u1'),
      ],
    }
    expect(() => buildAskTree(session, '坏数据')).not.toThrow()
  })
})

describe('askTreePath / flattenAskTree（当前位置与展开）', () => {
  it('askTreePath 返回根到目标的 id 链', () => {
    const tree = buildAskTree(nestedSession(), '会话标题')
    expect(askTreePath(tree, 'q3')).toEqual(['u1', 'q1', 'q3'])
    expect(askTreePath(tree, 'u1')).toEqual(['u1'])
    expect(askTreePath(tree, 'not-exist')).toEqual([])
  })

  it('默认只展开到当前位置：当前路径之外的分支折叠', () => {
    const tree = buildAskTree(nestedSession(), '会话标题')
    const expanded = new Set(['u1', 'q1'])
    const rows = flattenAskTree(tree, expanded, 'q3')
    expect(rows.map((row) => row.node.id)).toEqual(['u1', 'q1', 'q3', 'q2'])
    expect(rows.map((row) => row.expanded)).toEqual([true, true, false, false])
  })

  it('折叠根时只剩根一行', () => {
    const tree = buildAskTree(nestedSession(), '会话标题')
    const rows = flattenAskTree(tree, new Set(), null)
    expect(rows.map((row) => row.node.id)).toEqual(['u1'])
    expect(rows[0]!.hasChildren).toBe(true)
  })

  it('全部展开时按深度优先铺开', () => {
    const tree = buildAskTree(nestedSession(), '会话标题')
    const rows = flattenAskTree(tree, new Set(['u1', 'q1', 'q2', 'q3']), null)
    expect(rows.map((row) => `${row.node.id}:${row.depth}`)).toEqual([
      'u1:0',
      'q1:1',
      'q3:2',
      'q2:1',
    ])
  })

  it('orphans 追加在末尾并带 orphan 标记', () => {
    const base = nestedSession()
    const session: Session = {
      ...base,
      messages: [
        ...base.messages,
        user('u2', null, undefined, 'a2'),
        assistant('a2', 'u2', '另一版回答。'),
        user('q9', 'a2', { anchorText: '另一版回答。', anchorMessageId: 'a2' }, 'r9'),
        assistant('r9', 'q9', '沉底回答。'),
      ],
    }
    const tree: AskTree = buildAskTree(session, '会话标题')
    const rows = flattenAskTree(tree, new Set(['u1']), null)
    const last = rows.at(-1)!
    expect(last.node.id).toBe('q9')
    expect(last.orphan).toBe(true)
  })
})
