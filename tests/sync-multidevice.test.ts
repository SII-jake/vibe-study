// @vitest-environment jsdom
// 多端同步修复（真机反馈 2026-11-22：网页版与手机版聊天数据没完全同步）。
// 三条缺陷：①只在启动拉一次，另一端改了看不到；②409 冲突后 baseVersion 不更新，
// 之后所有推送静默失败；③删除只删本地，远端还在 → 下次启动又复活。
import { describe, expect, it, vi } from 'vitest'
import {
  mergeSessions,
  nodesToSessions,
  pushSessions,
  schedulePush,
  syncOnce,
  flushPush,
  type SyncFetch,
} from '../web/src/services/chat/sync'
import type { Session } from '../web/src/services/chat/types'

const session = (id: string, updatedAt: number): Session => ({
  id,
  title: `话题${id}`,
  createdAt: 1,
  updatedAt,
  messages: [{ id: 'm1', role: 'user', content: 'q', files: [], createdAt: 1 }],
})

describe('409 冲突自愈：冲突后基准跟着前进，后续推送不再全失败', () => {
  it('冲突返回远端会话后，下一次推送用新版本号作 base', async () => {
    const calls: number[] = []
    const fetchImpl: SyncFetch = vi.fn(async (_input, init) => {
      const body = JSON.parse((init?.body as string) ?? '{}')
      calls.push(body.baseVersion)
      if (calls.length === 1) {
        return new Response(
          JSON.stringify({ version: 12, nodes: [session('remote', 99)] }),
          { status: 409 },
        )
      }
      return new Response(JSON.stringify({ version: 13 }), { status: 200 })
    })

    schedulePush([session('a', 10)], fetchImpl, 0)
    await flushPush()
    // 冲突时把远端会话合进来重推，且 base 已前移到 12
    schedulePush([session('a', 11)], fetchImpl, 0)
    await flushPush()

    expect(calls[0]).toBe(0)
    expect(calls[1]).toBe(12)
  })
})

describe('删除会传播：本地删除的会话不能靠远端复活', () => {
  it('mergeSessions 支持删除集合——被删的远端会话不再并入', () => {
    const local = [session('keep', 10)]
    const remote = [session('keep', 10), session('deleted', 50)]
    const merged = mergeSessions(local, remote, new Set(['deleted']))
    expect(merged.map((s) => s.id)).toEqual(['keep'])
  })

  it('删除集合为空时行为不变（向后兼容）', () => {
    const merged = mergeSessions([session('a', 10)], [session('b', 20)])
    expect(merged.map((s) => s.id).sort()).toEqual(['a', 'b'])
  })
})

describe('运行期增量拉取：切回标签页能看到另一端的改动', () => {
  it('pullSessions 拉远端；本地较新的同名会话不被覆盖', async () => {
    const { pullSessions } = await import('../web/src/services/chat/sync')
    const fetchImpl: SyncFetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          version: 9,
          nodes: [session('same', 100), session('only-remote', 90)],
        }),
        { status: 200 },
      ),
    )
    const local = [session('same', 200)]
    const result = await pullSessions({ localSessions: local }, fetchImpl)
    // pullSessions 直接返回合并后的会话列表（调用方不必再解一层 nodes）
    expect(result?.sessions.find((s) => s.id === 'same')?.updatedAt).toBe(200)
    expect(result?.sessions.some((s) => s.id === 'only-remote')).toBe(true)
    expect(result?.version).toBe(9)
  })
})

describe('syncOnce 与删除集合协同', () => {
  it('启动对齐时带删除集合，被删会话不会因远端还在而回归', async () => {
    const fetchImpl: SyncFetch = vi.fn(async () =>
      new Response(JSON.stringify({ version: 3, nodes: [session('gone', 5)] }), { status: 200 }),
    )
    const result = await syncOnce(
      { baseVersion: 0, localSessions: [], deletedIds: new Set(['gone']) },
      fetchImpl,
    )
    expect(result?.sessions.map((s) => s.id)).toEqual([])
  })
})

describe('推送把删除集合带给服务端（远端真正移除）', () => {
  it('pushSessions 的请求体带 nodes 为当前存活会话，被删会话自然不在其中', async () => {
    const fetchImpl: SyncFetch = vi.fn(async () =>
      new Response(JSON.stringify({ version: 4 }), { status: 200 }),
    )
    await pushSessions({ baseVersion: 3, sessions: [session('keep', 1)] }, fetchImpl)
    const body = JSON.parse(
      ((fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]?.body as string) ?? '{}',
    )
    expect(body.nodes.map((n: { id: string }) => n.id)).toEqual(['keep'])
  })
})

describe('删除墓碑落盘（离线删除后刷新不能复活）', () => {
  it('markSessionDeleted 写进 localStorage；墓碑随快照跨页面存活', async () => {
    localStorage.clear()
    vi.resetModules()
    const sync = await import('../web/src/services/chat/sync')
    sync.markSessionDeleted('gone-1')
    const raw = localStorage.getItem('chat-demo:deleted-sessions')
    expect(raw).not.toBeNull()
    expect(JSON.parse(raw as string)).toContain('gone-1')

    // 模拟刷新页面：模块重新加载后墓碑仍在（否则远端会话会复活）
    vi.resetModules()
    const reloaded = await import('../web/src/services/chat/sync')
    expect([...reloaded.getDeletedSessionIds()]).toContain('gone-1')
  })

  it('墓碑上限 500，超出丢最旧的，不会无限增长', async () => {
    localStorage.clear()
    vi.resetModules()
    const sync = await import('../web/src/services/chat/sync')
    for (let i = 0; i < 510; i++) sync.markSessionDeleted(`id-${i}`)
    const stored = JSON.parse(localStorage.getItem('chat-demo:deleted-sessions') as string) as string[]
    expect(stored.length).toBe(500)
    expect(stored).toContain('id-509')
    expect(stored).not.toContain('id-0')
  })
})
