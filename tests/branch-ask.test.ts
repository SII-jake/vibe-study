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
})

function normalize(s: Session): Session {
  return { ...s, rootMessageId: s.messages[0]?.id ?? null }
}
