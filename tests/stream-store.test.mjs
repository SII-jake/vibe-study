import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearOldEntries,
  computeStreamKey,
  createStreamStore,
} from '../server/stream-store.mjs'

const MESSAGES = [
  { role: 'user', content: '什么是复利？' },
]

describe('computeStreamKey', () => {
  it('对同一份消息与模型生成稳定的 key', () => {
    const a = computeStreamKey({ messages: MESSAGES, model: 'm' })
    const b = computeStreamKey({ messages: MESSAGES, model: 'm' })
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]{40}$/)
  })

  it('消息或模型不同则 key 不同', () => {
    const a = computeStreamKey({ messages: MESSAGES, model: 'm' })
    expect(computeStreamKey({ messages: MESSAGES, model: 'other' })).not.toBe(a)
    expect(
      computeStreamKey({ messages: [{ role: 'user', content: '别的问题' }], model: 'm' }),
    ).not.toBe(a)
  })

  it('key 不携带原始问题，避免把用户输入留在服务端调子键里', () => {
    const question = '这个问题不舒服被暴露出来'
    const key = computeStreamKey({ messages: [{ role: 'user', content: question }], model: 'm' })
    expect(key).not.toContain('这个问题')
    const referent = createHash('sha1')
      .update(JSON.stringify({ messages: MESSAGES, model: 'm' }))
      .digest('hex')
    expect(computeStreamKey({ messages: MESSAGES, model: 'm' })).toBe(referent)
  })
})

describe('createStreamStore', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-28T10:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('进行中与已完成两条轨迹都留得住', () => {
    const store = createStreamStore({ ttlMs: 5 * 60_000 })
    const key = 'key-running'

    store.begin(key, { content: '' })
    store.append(key, '复利')
    expect(store.get(key)).toMatchObject({ status: 'running', content: '复利' })

    store.append(key, '是利滚利')
    store.finish(key)
    expect(store.get(key)).toMatchObject({ status: 'done', content: '复利是利滚利' })
  })

  it('完成后再 append 不生效，已生成的内容不被覆盖', () => {
    const store = createStreamStore({ ttlMs: 5 * 60_000 })
    const key = 'key-done'
    store.begin(key, { content: '' })
    store.finish(key)
    store.append(key, '不该出现')
    expect(store.get(key)).toMatchObject({ status: 'done', content: '' })
  })

  it('reset 清空半成品内容；模型先说话又调工具的情况需要重发', () => {
    const store = createStreamStore({ ttlMs: 5 * 60_000 })
    const key = 'key-reset'
    store.begin(key, { content: '我先查一下' })
    store.reset(key)
    expect(store.get(key)).toMatchObject({ status: 'running', content: '' })
  })

  it('拉起不存在的 key 返回 null，不创建一条空记录', () => {
    const store = createStreamStore({ ttlMs: 5 * 60_000 })
    expect(store.get('missing')).toBeNull()
  })

  it('超过 ttl 的条目被清掉；临走前扫一次的调用方会另外触发', () => {
    const ttlMs = 5 * 60_000
    const store = createStreamStore({ ttlMs })
    store.begin('old', { content: '' })
    store.finish('old')

    // 把旧记录的时间戳回拨到窗口之外；新记录留在窗口内
    const old = store.entries.get('old')
    old.updatedAt = Date.now() - (ttlMs + 1)

    store.begin('new', { content: '' })
    store.finish('new')

    // 时钟不往前推：清理判断只看 updatedAt 是否与当前时刻差 ttl，
    // 避免「新记录也过期了」这种时间快进把断言带偏
    expect(clearOldEntries(store.entries, ttlMs, Date.now())).toBe(1)
    expect(store.get('old')).toBeNull()
    expect(store.get('new')).toBeTruthy()
  })
})
