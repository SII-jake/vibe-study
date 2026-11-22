// @vitest-environment jsdom
// 前端拉取并发守卫（2026-11-22 实测：整库快照 2.24 MB，公网约 180 KB/s，
// 一次整棵拉取 10.9~12.3 秒）。切回标签页与窗口聚焦都会触发 pullSessions，
// 且没有并发守卫——来回切几次就堆起多个 2.24 MB 传输，主线程被占满，
// 新的 css/js 请求只能排在后面等，观感是"这个 css 一直卡死"。
// 口径：同一时刻只允许一个拉取在飞；重复触发直接复用同一个 Promise。
import { describe, expect, it, vi } from 'vitest'
import { pullSessions, type SyncFetch } from '../web/src/services/chat/sync'
import type { Session } from '../web/src/services/chat/types'

const session = (id: string, updatedAt: number): Session => ({
  id,
  title: `话题${id}`,
  createdAt: 1,
  updatedAt,
  messages: [{ id: 'm1', role: 'user', content: 'q', files: [], createdAt: 1 }],
})

describe('pullSessions 并发守卫', () => {
  it('同时触发多次只发出一次请求，各调用方拿到同一份结果', async () => {
    let calls = 0
    let release: (() => void) | null = null
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const fetchImpl: SyncFetch = vi.fn(async () => {
      calls += 1
      await gate
      return new Response(JSON.stringify({ version: 7, nodes: [session('remote', 5)] }), { status: 200 })
    })

    const args = { baseVersion: 0, localSessions: [session('local', 1)] as Session[] }
    // 三个触发点几乎同时发生（标签页/窗口聚焦可能连发）
    const all = Promise.all([
      pullSessions(args, fetchImpl),
      pullSessions(args, fetchImpl),
      pullSessions(args, fetchImpl),
    ])
    await Promise.resolve()
    release?.()
    const results = await all

    expect(calls).toBe(1)
    for (const result of results) {
      expect(result?.version).toBe(7)
      expect(result?.sessions.map((s) => s.id).sort()).toEqual(['local', 'remote'])
    }
  })

  it('前一次完成后再次触发会重新请求（守卫不缓存结果）', async () => {
    let calls = 0
    const fetchImpl: SyncFetch = vi.fn(async () => {
      calls += 1
      return new Response(JSON.stringify({ version: calls, nodes: [session('r', 1)] }), { status: 200 })
    })
    const args = { baseVersion: 0, localSessions: [] as Session[] }

    await pullSessions(args, fetchImpl)
    await pullSessions(args, fetchImpl)
    expect(calls).toBe(2)
  })

  it('某次拉取失败后，后续触发仍能正常重试（失败不锁死守卫）', async () => {
    let calls = 0
    const fetchImpl: SyncFetch = vi.fn(async () => {
      calls += 1
      if (calls === 1) throw new TypeError('fetch failed')
      return new Response(JSON.stringify({ version: 9, nodes: [] }), { status: 200 })
    })
    const args = { baseVersion: 0, localSessions: [] as Session[] }

    expect(await pullSessions(args, fetchImpl)).toBeNull()
    const second = await pullSessions(args, fetchImpl)
    expect(calls).toBe(2)
    expect(second?.version).toBe(9)
  })
})
