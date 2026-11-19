// 追问分支的数据模型规格：追问消息的类型标记、锚点保留、兄弟并列陈列契约
import { describe, expect, it } from 'vitest'
import { appendBranch, getVisibleMessages, selectVersion } from '../web/src/services/chat/branches'
import type { Session, UserMessage } from '../web/src/services/chat/types'

const rootMsg: UserMessage = {
  id: 'm1', role: 'user', content: '什么是复利', files: [], createdAt: 1,
}
const session: Session = { id: 's1', title: '复利', createdAt: 1, updatedAt: 1, messages: [rootMsg] }

describe('追问分支（ask 型兄弟分支）', () => {
  it('可以在同一条回答下挂多条并列追问，且各自保留锚点', () => {
    let s = normalize(session)
    s = appendBranch(s, 'm1', [{
      id: 'a1', role: 'user', content: '开头这段能展开吗', files: [], createdAt: 2,
      ask: { anchorText: '开头这段', anchorMessageId: 'm1' },
    } as UserMessage])
    s = appendBranch(s, 'm1', [{
      id: 'a2', role: 'user', content: '结尾那半句什么意思', files: [], createdAt: 3,
      ask: { anchorText: '结尾那半句', anchorMessageId: 'm1' },
    } as UserMessage])

    // 两条追问挂在同一个父消息下
    const children = s.messages.filter((m) => m.parentId === 'm1')
    expect(children.map((m) => m.id)).toContain('a1')
    expect(children.map((m) => m.id)).toContain('a2')
    // 追问标记保留锚点原文与其来源消息
    expect((children.find((m) => m.id === 'a1') as UserMessage & { ask?: { anchorText: string } }).ask?.anchorText).toBe('开头这段')
    expect((children.find((m) => m.id === 'a2') as UserMessage & { ask?: { anchorText: string } }).ask?.anchorText).toBe('结尾那半句')
  })

  it('并列追问的选中路径互不干扰：选择 a1 不影响 a2 继续存在', () => {
    let s = normalize(session)
    s = appendBranch(s, 'm1', [{ id: 'a1', role: 'user', content: '追问一', files: [], createdAt: 2 } as UserMessage])
    s = appendBranch(s, 'm1', [{ id: 'a2', role: 'user', content: '追问二', files: [], createdAt: 3 } as UserMessage])
    // 选中 a1 后可视链走到它
    s = selectVersion(s, 'a1')
    expect(getVisibleMessages(s).map((m) => m.id)).toEqual(['m1', 'a1'])
    // a2 的兄弟群还在（父消息下不止一个子）
    expect(s.messages.filter((m) => m.parentId === 'm1').length).toBe(2)
  })

  // decisions/2026-11-19 §二.6：追问的问答不占中栏正文——挂上追问后主线可见链
  // 必须停在追问挂载点之内；selectedChildId 是"同槽位版本切换"语义，
  // 追问分支靠 ask 字段反查（AskBranches 路径），不需要也不应能被它选中顶进主线。
  it('挂追问分支不改写父消息 selectedChildId，主线可见链不被顶穿', () => {
    let s = normalize(session)
    s = appendBranch(s, 'm1', [{ id: 'a1', role: 'assistant', content: '答一', parts: [], createdAt: 2, status: 'done' } as never])
    expect(s.messages.find((m) => m.id === 'm1')?.selectedChildId).toBe('a1')
    s = appendBranch(s, 'a1', [
      { id: 'q1', role: 'user', content: '追问', files: [], createdAt: 3, ask: { anchorText: '答', anchorMessageId: 'a1' } } as UserMessage,
      { id: 'r1', role: 'assistant', content: '追问答', parts: [], createdAt: 4, status: 'done' } as never,
    ])
    // 主线 lane 仍停在主线叶子，不走进追问分支
    expect(s.messages.find((m) => m.id === 'a1')?.selectedChildId).not.toBe('q1')
    expect(getVisibleMessages(s).map((m) => m.id)).toEqual(['m1', 'a1'])
  })

  it('读取侧兜底：selectedChildId 已被旧数据指进追问分支时，可见链在挂载点截断', () => {
    let s = normalize(session)
    s = appendBranch(s, 'm1', [{ id: 'a1', role: 'assistant', content: '答一', parts: [], createdAt: 2, status: 'done' } as never])
    // 模拟旧数据：selectedChildId 已被追问分支改写（修复前 askAt 的行为）
    s = {
      ...s,
      messages: [
        ...s.messages.map((m) => (m.id === 'a1' ? { ...m, selectedChildId: 'q1' } : m)),
        { id: 'q1', role: 'user', content: '追问', files: [], createdAt: 3, parentId: 'a1', ask: { anchorText: '答', anchorMessageId: 'a1' } } as UserMessage,
      ],
    }
    expect(getVisibleMessages(s).map((m) => m.id)).toEqual(['m1', 'a1'])
  })
})

function normalize(s: Session): Session {
  return { ...s, rootMessageId: s.messages[0]?.id ?? null }
}
