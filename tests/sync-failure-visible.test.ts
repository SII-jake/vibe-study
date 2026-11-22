// @vitest-environment jsdom
// B 的前端半边：推送失败不再静默（真机反馈 2026-11-22）。
// 修复前 pushSessions 对 413 与断连一律 return null，schedulePush 也不报，
// 用户完全看不到"写入没上去"——远端 H3 会话因此长期停在旧版本。
import { describe, expect, it, vi } from 'vitest'
import { getLastSyncFailure, pushSessions, type SyncFetch } from '../web/src/services/chat/sync'
import type { Session } from '../web/src/services/chat/types'

const session = (id: string, updatedAt: number): Session => ({
  id,
  title: `话题${id}`,
  createdAt: 1,
  updatedAt,
  messages: [{ id: 'm1', role: 'user', content: 'q', files: [], createdAt: 1 }],
})

describe('推送失败必须可观测', () => {
  it('413 记录为 too-large 并 console.warn（不再只返回 null）', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fetchImpl: SyncFetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: '请求体过大', limit: 1024 }), { status: 413 }),
    )
    await pushSessions({ baseVersion: 0, sessions: [session('a', 1)] }, fetchImpl)
    expect(getLastSyncFailure()?.reason).toBe('too-large')
    expect(getLastSyncFailure()?.status).toBe(413)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('网络层异常记录为 network，同样不静默', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fetchImpl: SyncFetch = vi.fn(async () => {
      throw new TypeError('fetch failed')
    })
    await pushSessions({ baseVersion: 0, sessions: [session('a', 1)] }, fetchImpl)
    expect(getLastSyncFailure()?.reason).toBe('network')
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('推送成功清掉上一次的失败记录', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const bad: SyncFetch = vi.fn(async () => new Response('{}', { status: 500 }))
    await pushSessions({ baseVersion: 0, sessions: [session('a', 1)] }, bad)
    expect(getLastSyncFailure()).not.toBeNull()

    const ok: SyncFetch = vi.fn(async () => new Response(JSON.stringify({ version: 5 }), { status: 200 }))
    await pushSessions({ baseVersion: 0, sessions: [session('a', 1)] }, ok)
    expect(getLastSyncFailure()).toBeNull()
    warn.mockRestore()
  })
})
