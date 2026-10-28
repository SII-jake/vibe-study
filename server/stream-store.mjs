/**
 * 服务端生成残迹仓库。
 *
 * 用途：客户端刷新/切断连接后，服务端不再连带中止生成，而是把这次回答
 * 跑完并暂存一份；前端可以按同一 key 把完整结果拉回来接着看。
 *
 * 只留短窗口（默认几分钟）的内存快照 —— 它不是持久层，进程重启即丢。
 * key 是消息内容的哈希，不把用户提问原文留在记录键里。
 */

import { createHash } from 'node:crypto'

/** 默认暂存窗口：幂等 redis 里通常只需要遇到一次刷新 */
export const DEFAULT_TTL_MS = 5 * 60_000

/** 生成本次对话的残迹 key：内容哈希，与消息与模型同时决定。 */
export function computeStreamKey({ messages, model }) {
  return createHash('sha1').update(JSON.stringify({ messages, model })).digest('hex')
}

/** 单条残迹：进行中或已完成；内容与状态独立维护，完成后再 claim 不覆盖。 */
export function createStreamStore({ ttlMs = DEFAULT_TTL_MS } = {}) {
  /** @type {Map<string, {status: 'running'|'done', content: string, updatedAt: number}>} */
  const entries = { map: new Map(), ttlMs }

  entries.entries = entries.map // 方便 clearOldEntries 直接操作 Map

  entries.begin = (key, initial) => {
    entries.map.set(key, {
      status: initial?.status ?? 'running',
      content: initial?.content ?? '',
      updatedAt: Date.now(),
    })
  }

  entries.append = (key, delta) => {
    const cur = entries.map.get(key)
    if (!cur || cur.status !== 'running') return
    cur.content += delta
    cur.updatedAt = Date.now()
  }

  entries.reset = (key) => {
    const cur = entries.map.get(key)
    if (!cur || cur.status !== 'running') return
    cur.content = ''
    cur.updatedAt = Date.now()
  }

  entries.finish = (key) => {
    const cur = entries.map.get(key)
    if (!cur || cur.status !== 'running') return
    cur.status = 'done'
    cur.updatedAt = Date.now()
  }

  entries.get = (key) => entries.map.get(key) ?? null

  return entries
}

/**
 * 清掉超过 ttl 的条目，返回清掉的条数。
 * 由调用方决定何时调用（如每次请求或定时任务）。
 * now 可注入：让清理是否发生不依赖调用与不发生的系统时间。
 */
export function clearOldEntries(entries, ttlMs, now = Date.now()) {
  let removed = 0
  for (const [key, value] of entries) {
    if (now - value.updatedAt > ttlMs) {
      entries.delete(key)
      removed += 1
    }
  }
  return removed
}
