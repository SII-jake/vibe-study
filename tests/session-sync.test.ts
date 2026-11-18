// 会话多端同步：demo Session[] 与 /api/nodes 通用 JSON 数组的双向映射 + 乐观锁推送
import { describe, expect, it, vi } from 'vitest'
import { sessionsToNodes, nodesToSessions, pushSessions, syncOnce, type SyncFetch } from '../web/src/services/chat/sync'
import type { Session } from '../web/src/services/chat/types'

const session = (id: string, updatedAt: number): Session => ({
  id, title: `话题${id}`, createdAt: 1, updatedAt,
  messages: [{ id: 'm1', role: 'user', content: 'q', files: [], createdAt: 1 }],
})

describe('会话同步映射', () => {
  it('Session[] → nodes：每个会话作为独立元素，id 在场', () => {
    const nodes = sessionsToNodes([session('a', 10), session('b', 20)])
    expect(nodes.length).toBe(2)
    expect(nodes.every((n) => typeof n === 'object' && n !== null && 'id' in n)).toBe(true)
  })

  it('nodes → Session[]：非会话元素被过滤，空数组安全', () => {
    const sessions = nodesToSessions([session('a', 10), { foo: 'bar' }, null] as unknown[])
    expect(sessions.length).toBe(1)
    expect(sessions[0]?.id).toBe('a')
    expect(nodesToSessions([])).toEqual([])
  })

  it('往返无损：Session[] ⇄ nodes 保持会话形状', () => {
    const original = [session('a', 10), session('b', 20)]
    expect(nodesToSessions(sessionsToNodes(original))).toEqual(original)
  })
})

describe('pushSessions（乐观锁推送）', () => {
  const okFetch: SyncFetch = vi.fn(async () => new Response(JSON.stringify({ version: 7 }), { status: 200 }))

  it('成功时带 baseVersion 与会话数组 PUT /api/nodes', async () => {
    const result = await pushSessions({ baseVersion: 6, sessions: [session('a', 10)] }, okFetch)
    expect(result).toEqual({ ok: true, version: 7 })
    expect(okFetch).toHaveBeenCalledWith('/api/nodes', expect.objectContaining({ method: 'PUT' }))
    const body = JSON.parse((okFetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]?.body as string)
    expect(body.baseVersion).toBe(6)
    expect(Array.isArray(body.nodes)).toBe(true)
  })

  it('409 冲突时返回最新版本与远端会话', async () => {
    const conflictFetch: SyncFetch = vi.fn(async () =>
      new Response(JSON.stringify({ version: 9, nodes: sessionsToNodes([session('remote', 99)]) }), { status: 409 }),
    )
    const result = await pushSessions({ baseVersion: 6, sessions: [] }, conflictFetch)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.version).toBe(9)
      expect(result.sessions[0]?.id).toBe('remote')
    }
  })

  it('网络错误返回 null（不上抛，由调用方决定后续）', async () => {
    const deadFetch: SyncFetch = vi.fn(async () => { throw new TypeError('fetch failed') })
    expect(await pushSessions({ baseVersion: 0, sessions: [] }, deadFetch)).toBeNull()
  })
})

describe('syncOnce（启动时对接）', () => {
  it('远端版本更高时采纳远端会话', async () => {
    const remote = [session('r1', 100)]
    const fetchImpl: SyncFetch = vi.fn(async () =>
      new Response(JSON.stringify({ version: 5, nodes: sessionsToNodes(remote) }), { status: 200 }),
    )
    const result = await syncOnce({ baseVersion: 0, localSessions: [session('local', 1)] }, fetchImpl)
    // 多端共存：远端会话并入本地列表；本地独有会话不被远端缺失抹掉（删除语义先不引入）
    expect(result?.sessions.map((s) => s.id).sort()).toEqual(['local', 'r1'])
    expect(result?.version).toBe(5)
  })

  it('本地与远端重叠时按 updatedAt 合并取新', async () => {
    const local = [session('same', 50)]
    const remote = [session('same', 80), session('r-only', 90)]
    const fetchImpl: SyncFetch = vi.fn(async () =>
      new Response(JSON.stringify({ version: 5, nodes: sessionsToNodes(remote) }), { status: 200 }),
    )
    const result = await syncOnce({ baseVersion: 0, localSessions: local }, fetchImpl)
    // 远端 updatedAt 更新 → 采纳远端版本；本地没有的会话也进来
    expect(result?.sessions.find((s) => s.id === 'same')?.updatedAt).toBe(80)
    expect(result?.sessions.some((s) => s.id === 'r-only')).toBe(true)
  })
})
