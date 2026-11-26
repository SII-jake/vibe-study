/**
 * 生成任务仓储（用户 2026-11-26 定：任务存内存，粒度 = 一条 lane 一个任务）。
 *
 * 要解决的根问题：流的生命周期原来挂在浏览器连接上。页面一刷新，连接就断，
 * handler 的 finally 里 reader.cancel() 把上游也掐了，于是回复永远停在半截。
 *
 * 现在的分工：任务在这里独立持有上游流与已产出的片段；HTTP 连接只是"订阅"。
 * 订阅者断掉不取消上游（这是刷新不中断的全部秘密），重新订阅按游标回放即可接上。
 *
 * 存内存不动盘——用户明确只要"刷新页面不中断"，不需要跨进程重启或跨设备续接。
 * 进程重启即全丢，前端会照旧把半截回复收成 stopped。
 *
 * 本模块只做纯状态管理与生命周期，HTTP 接线落在 handler.mjs。
 */

/** 已结束任务默认保留 30 分钟：够用户刷新、切标签页回来重新订阅。 */
const DEFAULT_TTL_MS = 30 * 60 * 1000

export function createTaskStore(opts = {}) {
  const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS
  const now = opts.now ?? Date.now
  /** id → 任务。payload 对仓储不透明：由 run 决定结构（HTTP 层塞的是原始 SSE 文本块）。 */
  const tasks = new Map()

  const notify = (task, seq, payload) => {
    for (const listener of [...task.listeners]) {
      listener.onEvent(seq, payload)
    }
  }

  /**
   * 起一个任务。run(emit, signal) 负责产出片段；emit 只在任务仍在跑时记账。
   * 同 id 的**在跑**任务不覆盖——重发请求不该顶掉正在跑的那条；
   * 已结束的可以重建：续写/重试复用同一 lane 键，上一轮早就收尾了。
   */
  const create = (id, run, options = {}) => {
    const existing = tasks.get(id)
    if (existing?.status === 'running') {
      return existing
    }
    const controller = new AbortController()
    const task = {
      id,
      status: 'running',
      /** 已产出的片段，下标即游标（seq） */
      events: [],
      error: null,
      /** 任务开始前该回复已有的块数：刷新重连时据此裁回起点再重放，避免重复块 */
      baseBlocks: options.baseBlocks ?? 0,
      controller,
      listeners: new Set(),
      finishedAt: null,
      /** 区分"自己停的"与"上游自己断开"：前者记 aborted，后者记 error */
      aborting: false,
    }
    tasks.set(id, task)

    const emit = (payload) => {
      if (task.status !== 'running') {
        return
      }
      const seq = task.events.length
      task.events.push(payload)
      notify(task, seq, payload)
    }

    task.settled = (async () => {
      try {
        await run(emit, controller.signal)
        if (task.status === 'running') {
          task.status = task.aborting ? 'aborted' : 'done'
        }
      } catch (error) {
        task.status = task.aborting ? 'aborted' : 'error'
        task.error = error instanceof Error ? error.message : String(error)
      } finally {
        task.finishedAt = now()
        // 收尾通知：订阅方据此结束 SSE 响应，不要挂着等一个永不再来的事件
        for (const listener of [...task.listeners]) {
          listener.onEnd?.()
        }
        task.listeners.clear()
      }
    })()
    return task
  }

  const get = (id) => tasks.get(id)

  /** 等某个任务跑完（测试与收尾用）；未知任务视为已结束。 */
  const settled = (id) => tasks.get(id)?.settled ?? Promise.resolve()

  /**
   * 订阅：先同步回放 since 之后的片段，任务仍在跑就挂上实时推送。
   * 返回退订函数——退订只影响这个订阅者，上游照跑。
   */
  const subscribe = (id, since, onEvent, onEnd) => {
    const task = tasks.get(id)
    if (!task) {
      throw new Error(`未知任务：${id}`)
    }
    for (let seq = Math.max(0, since); seq < task.events.length; seq += 1) {
      onEvent(seq, task.events[seq])
    }
    if (task.status !== 'running') {
      onEnd?.()
      return () => {}
    }
    const listener = { onEvent, onEnd }
    task.listeners.add(listener)
    return () => {
      task.listeners.delete(listener)
    }
  }

  /** 停任务：只置中止标记并让上游收到取消信号，收尾仍走 settled。 */
  const abort = (id) => {
    const task = tasks.get(id)
    if (!task || task.status !== 'running') {
      return false
    }
    task.aborting = true
    task.controller.abort()
    return true
  }

  /** 清掉超过 TTL 的已结束任务；在跑的一律不动。 */
  const sweep = () => {
    const current = now()
    for (const [id, task] of tasks) {
      if (task.status === 'running' || task.finishedAt === null) {
        continue
      }
      if (current - task.finishedAt >= ttlMs) {
        tasks.delete(id)
      }
    }
  }

  return { create, get, settled, subscribe, abort, sweep, size: () => tasks.size }
}
