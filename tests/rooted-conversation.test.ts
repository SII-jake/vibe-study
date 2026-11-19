// 右栏子对话取链（decisions/2026-11-19 §二.4）：以追问分支的根用户消息为
// 新的 rootMessageId，getVisibleMessages 沿 selectedChildId 走出的就是
// "该追问及其后续追问"的完整子对话链——复用分支视图模型，不发明新遍历。
import { describe, expect, it } from 'vitest'
import { rootedConversation } from '../web/src/services/chat/rootedConversation.js'
import { getVisibleMessages } from '../web/src/services/chat/branches.js'
import type { Session, Message } from '../web/src/services/chat/types.js'

const msg = (id: string, role: 'user' | 'assistant', parentId: string | null, selectedChildId?: string, extra = {}) =>
  ({
    id,
    role,
    content: id,
    files: [],
    createdAt: 1,
    parts: [],
    status: 'done',
    ...(parentId !== undefined ? { parentId } : {}),
    ...(selectedChildId ? { selectedChildId } : {}),
    ...extra,
  }) as unknown as Message

describe('rootedConversation：子对话取链', () => {
  it('以追问根消息为起点沿 selectedChildId 走链（含追问+回答+后续第一项）', () => {
    const session: Session = {
      id: 's1',
      title: '',
      createdAt: 1,
      updatedAt: 1,
      rootMessageId: 'u1',
      messages: [
        msg('u1', 'user', null, 'a1'),
        msg('a1', 'assistant', 'u1', 'q1'),
        // 主楼第二段原本的下一条是 u2，但 a1 的 selectedChildId 被追问改写指向 q1（分支）
        msg('q1', 'user', 'a1', 'aq1', { ask: { anchorText: 'x', anchorMessageId: 'a1', fragmentIndex: 0 } }),
        msg('aq1', 'assistant', 'q1'),
        msg('u2', 'user', 'a1'),
        msg('a2', 'assistant', 'u2'),
      ],
    }
    const out = rootedConversation(session, 'q1')
    expect(out?.rootMessageId).toBe('q1')
    // 换根但保留全量消息：分支卡要靠全量反查下一层追问入口；
    // 可见链由 getVisibleMessages 缩到该 lane（主线不走进来）
    expect(out?.messages.map((m) => m.id)).toEqual(['u1', 'a1', 'q1', 'aq1', 'u2', 'a2'])
    expect(out && getVisibleMessages(out).map((m) => m.id)).toEqual(['q1', 'aq1'])
  })

  it('找不到分支根 id 时返回 null', () => {
    const session: Session = {
      id: 's1',
      title: '',
      createdAt: 1,
      updatedAt: 1,
      rootMessageId: 'u1',
      messages: [msg('u1', 'user', null), msg('a1', 'assistant', 'u1')],
    }
    expect(rootedConversation(session, 'missing')).toBeNull()
  })
})
