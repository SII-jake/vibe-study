// 生成任务仓储（用户 2026-11-26 定：任务存内存，任务粒度 = 一条 lane 一个任务）。
// 目标口径：刷新页面只断开订阅，上游流继续跑；重新按 since 回放就能接上。
// 这条口径的关键不是"能重连"，而是"没人订阅时上游不许被取消"——修复前
// handler.mjs 在 finally 里 reader.cancel()，页面一刷新就把上游掐了。
import { describe, expect, it, vi } from 'vitest'
import { createTaskStore } from '../server/task-store.mjs'

const event = (type, extra = {}) => ({ event: 'message', data: JSON.stringify({ type, ...extra }) })

describe('生成任务仓储：生命周期', () => {
  it('创建后可取回，状态先 running 后 done', async () => {
    const store = createTaskStore()
    let release
    const gate = new Promise((resolve) => {
      release = resolve
    })
    store.create('t1', async (emit) => {
      emit(event('message_start'))
      await gate
      emit(event('message_stop'))
    })
    expect(store.get('t1')?.status).toBe('running')
    release()
    await store.settled('t1')
    expect(store.get('t1')?.status).toBe('done')
    expect(store.get('t1')?.events).toHaveLength(2)
  })

  it('没人订阅时上游照样跑完——这是刷新不中断的根', async () => {
    const store = createTaskStore()
    const seen = []
    store.create('t1', async (emit) => {
      seen.push(1)
      emit(event('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }))
      await Promise.resolve()
      emit(event('content_block_delta', { index: 0, delta: { type: 'text_delta', text: '答' } }))
    })
    await store.settled('t1')
    // 全程没有任何订阅者，事件仍然全部落账
    expect(seen).toEqual([1])
    expect(store.get('t1')?.events).toHaveLength(2)
    expect(store.get('t1')?.status).toBe('done')
  })

  it('上游抛错记为 error，已有事件保留', async () => {
    const store = createTaskStore()
    store.create('t1', async (emit) => {
      emit(event('message_start'))
      throw new Error('上游断了')
    })
    await store.settled('t1')
    expect(store.get('t1')?.status).toBe('error')
    expect(store.get('t1')?.error).toBe('上游断了')
    expect(store.get('t1')?.events).toHaveLength(1)
  })

  it('同 id 重复创建不覆盖已有任务（重发请求不该顶掉在跑的那条）', async () => {
    const store = createTaskStore()
    const first = vi.fn(async () => {})
    const second = vi.fn(async () => {})
    store.create('t1', first)
    store.create('t1', second)
    await store.settled('t1')
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).not.toHaveBeenCalled()
  })

  it('同 id 在旧任务结束后可以重建（续写复用同一 lane 键）', async () => {
    const store = createTaskStore()
    store.create('t1', async (emit) => {
      emit(event('message_stop'))
    })
    await store.settled('t1')
    const second = vi.fn(async (emit) => {
      emit(event('message_start'))
    })
    store.create('t1', second)
    await store.settled('t1')
    expect(second).toHaveBeenCalledTimes(1)
    // 重建后事件从空开始，不回放上一轮
    expect(store.get('t1')?.events).toHaveLength(1)
  })

  it('baseBlocks 记在任务上，供刷新后重连裁掉本地已有的前缀块', async () => {
    const store = createTaskStore()
    store.create('t1', async () => {}, { baseBlocks: 3 })
    expect(store.get('t1')?.baseBlocks).toBe(3)
  })
})

describe('生成任务仓储：订阅与回放', () => {
  it('后到的订阅者按 since 拿到全部历史，再接实时', async () => {
    const store = createTaskStore()
    let release
    const gate = new Promise((resolve) => {
      release = resolve
    })
    store.create('t1', async (emit) => {
      emit(event('a'))
      emit(event('b'))
      await gate
      emit(event('c'))
    })
    await Promise.resolve()
    const got = []
    const off = store.subscribe('t1', 0, (seq, ev) => got.push([seq, JSON.parse(ev.data).type]))
    // 历史立刻补齐
    expect(got).toEqual([
      [0, 'a'],
      [1, 'b'],
    ])
    release()
    await store.settled('t1')
    expect(got.at(-1)).toEqual([2, 'c'])
    off()
  })

  it('since 游标跳过已收过的事件，供断线重连续上', async () => {
    const store = createTaskStore()
    store.create('t1', async (emit) => {
      emit(event('a'))
      emit(event('b'))
      emit(event('c'))
    })
    await store.settled('t1')
    const got = []
    store.subscribe('t1', 1, (seq) => got.push(seq))
    expect(got).toEqual([1, 2])
  })

  it('取消订阅后不再收到新事件，但任务继续跑', async () => {
    const store = createTaskStore()
    let release
    const gate = new Promise((resolve) => {
      release = resolve
    })
    store.create('t1', async (emit) => {
      emit(event('a'))
      await gate
      emit(event('b'))
    })
    await Promise.resolve()
    const got = []
    const off = store.subscribe('t1', 0, (seq) => got.push(seq))
    off()
    release()
    await store.settled('t1')
    expect(got).toEqual([0])
    expect(store.get('t1')?.events).toHaveLength(2)
  })

  it('任务已完成时订阅：回放历史后立刻结束，不挂着', async () => {
    const store = createTaskStore()
    store.create('t1', async (emit) => {
      emit(event('a'))
      emit(event('message_stop'))
    })
    await store.settled('t1')
    const got = []
    const off = store.subscribe('t1', 0, (seq) => got.push(seq), () => got.push('end'))
    expect(got).toEqual([0, 1, 'end'])
    off()
  })

  it('未知任务返回 undefined，订阅抛错由调用方转 404', () => {
    const store = createTaskStore()
    expect(store.get('nope')).toBeUndefined()
    expect(() => store.subscribe('nope', 0, () => {})).toThrow(/未知任务/)
  })
})

describe('生成任务仓储：停止与过期清理', () => {
  it('abort 让上游收到取消信号，状态记 aborted', async () => {
    const store = createTaskStore()
    let aborted = false
    store.create('t1', async (_emit, signal) => {
      await new Promise((_, reject) => {
        signal.addEventListener('abort', () => {
          aborted = true
          reject(new Error('aborted'))
        })
      })
    })
    store.abort('t1')
    await store.settled('t1')
    expect(aborted).toBe(true)
    expect(store.get('t1')?.status).toBe('aborted')
    // 主动停止不是失败：error 留给真正的错误，否则展示层会据此冒出错误提示
    expect(store.get('t1')?.error ?? null).toBe(null)
  })

  it('超过 TTL 的已结束任务被清掉，在跑的不清', async () => {
    let clock = 1000
    const store = createTaskStore({ ttlMs: 100, now: () => clock })
    store.create('done', async (emit) => {
      emit(event('message_stop'))
    })
    await store.settled('done')
    let release
    const gate = new Promise((resolve) => {
      release = resolve
    })
    store.create('running', async () => {
      await gate
    })
    clock = 1200
    store.sweep()
    expect(store.get('done')).toBeUndefined()
    expect(store.get('running')?.status).toBe('running')
    release()
    await store.settled('running')
  })
})
