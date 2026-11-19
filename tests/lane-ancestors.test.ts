// lane 祖先链纯计算（decisions/2026-11-19 §二.1 + 附录：视口状态只存
// {centerNodeId, rightNodeId}；lane 序列从 centerNodeId 沿 ask 锚点爬出，
// 不另存 React 状态）。
import { describe, expect, it } from 'vitest'
import { laneAncestors } from '../web/src/services/chat/rootedConversation.js'
import type { Session, Message } from '../web/src/services/chat/types.js'

const msg = (
  id: string,
  role: 'user' | 'assistant',
  parentId: string | null,
  extra: Record<string, unknown> = {},
): Message =>
  ({
    id,
    role,
    content: id,
    files: [],
    createdAt: 1,
    ...(parentId !== undefined ? { parentId } : {}),
    ...(role === 'assistant'
      ? { model: null, prefix: true, status: 'done', blocks: [] }
      : {}),
    ...extra,
  }) as unknown as Message

describe('laneAncestors：lane 祖先链纯计算', () => {
  it('主线根只有自己一格', () => {
    const session: Session = {
      id: 's1', title: '', createdAt: 1, updatedAt: 1, rootMessageId: 'u1',
      messages: [msg('u1', 'user', null), msg('a1', 'assistant', 'u1')],
    }
    expect(laneAncestors(session, 'u1')).toEqual(['u1'])
  })

  it('ask 分支根沿锚点爬回主线：[主线根, 分支根]', () => {
    const session: Session = {
      id: 's1', title: '', createdAt: 1, updatedAt: 1, rootMessageId: 'u1',
      messages: [
        msg('u1', 'user', null),
        msg('a1', 'assistant', 'u1'),
        msg('q1', 'user', 'a1', { ask: { anchorText: 'x', anchorMessageId: 'a1', fragmentIndex: 0 } }),
        msg('r1', 'assistant', 'q1'),
      ],
    }
    expect(laneAncestors(session, 'q1')).toEqual(['u1', 'q1'])
  })

  it('嵌套 ask（孙分支）爬出三层链', () => {
    const session: Session = {
      id: 's1', title: '', createdAt: 1, updatedAt: 1, rootMessageId: 'u1',
      messages: [
        msg('u1', 'user', null),
        msg('a1', 'assistant', 'u1'),
        msg('q1', 'user', 'a1', { ask: { anchorText: 'x', anchorMessageId: 'a1', fragmentIndex: 0 } }),
        msg('r1', 'assistant', 'q1'),
        msg('q2', 'user', 'r1', { ask: { anchorText: 'y', anchorMessageId: 'r1', fragmentIndex: 0 } }),
        msg('r2', 'assistant', 'q2'),
      ],
    }
    expect(laneAncestors(session, 'q2')).toEqual(['u1', 'q1', 'q2'])
  })

  it('centerNodeId 为空或数据缺失时返回可得前缀不炸', () => {
    const session: Session = {
      id: 's1', title: '', createdAt: 1, updatedAt: 1, rootMessageId: 'u1',
      messages: [msg('u1', 'user', null)],
    }
    expect(laneAncestors(session, null)).toEqual([])
    expect(laneAncestors(session, 'missing')).toEqual([])
  })
})
