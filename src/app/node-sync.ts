/**
 * 对话持久化编排：与服务端唯一事实源保持问答树的同步。
 *
 * 三个动作各管一件事：
 * - start  启动时对齐一次基准；服务端还是空库就把本地推上去立基准，
 *   服务端已有数据（另一台设备先写过）就采用服务端快照覆盖本地。
 * - watch  本地每次变更登记最新快照，防抖后整棵上传；409 时按
 *   base/local/remote 三路合并重推。
 * - poll   轮询发现远端版本比基准新时合并远端进来，并回推本端独有
 *   的部分，让各端收敛到同一棵树。
 */

import { fetchRemoteNodes, pushNodes } from '../ai/nodes'
import { mergeNodes } from '../domain/node-merge'
import type { LearnNode } from '../domain/tree'

export const PUSH_DEBOUNCE_MS = 400
export const POLL_INTERVAL_MS = 8000
const MAX_RETRIES = 3

export interface NodeSyncDeps {
  fetchImpl?: typeof fetch
  /** 读取本端当前节点树的最新值 */
  getLocal(): LearnNode[]
  /** 把树的最终落盘口径写回本端（IndexedDB） */
  replaceLocal(nodes: LearnNode[]): Promise<void>
  /**
   * 服务端快照被采用进本端状态时通知 UI 更新。
   * base 是参与本次合并的基准快照：实现方应把它与本端最新状态再并一次，
   * 保住采用瞬间本端刚发生的写入（如刚完成的流式回答）。
   */
  adoptRemote(nodes: LearnNode[], base: LearnNode[]): void
  debounceMs?: number
}

export interface NodeSyncHandle {
  start(): Promise<void>
  watch(nodes: LearnNode[]): void
  poll(): Promise<void>
  stop(): void
}

/** 问答树快照的深比较：无变化时跳过落盘与回推。 */
function deepEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true
  if (typeof left !== 'object' || left === null) return false
  if (typeof right !== 'object' || right === null) return false
  if (Array.isArray(left) !== Array.isArray(right)) return false
  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  if (leftKeys.length !== rightKeys.length) return false
  return leftKeys.every(
    (key) =>
      key in right &&
      deepEqual(
        (left as Record<string, unknown>)[key],
        (right as Record<string, unknown>)[key],
      ),
  )
}

export function createNodeSync(deps: NodeSyncDeps): NodeSyncHandle {
  const { getLocal, replaceLocal, adoptRemote } = deps
  const fetchImpl = deps.fetchImpl ?? fetch
  const debounceMs = deps.debounceMs ?? PUSH_DEBOUNCE_MS

  // base 是本端上次与服务端一致的快照基准；基准在内存里重建，刷新后以最新醒来的那份为准
  let baseVersion = -1
  let baseNodes: LearnNode[] = []
  let pushTimer: ReturnType<typeof setTimeout> | null = null
  let pollTimer: ReturnType<typeof setTimeout> | null = null
  /** 串行化上传，避免并发请求互相覆盖基准 */
  let uploadChain: Promise<void> = Promise.resolve()
  /** 防抖期内登记的最新本地快照 */
  let pendingLocal: LearnNode[] | null = null

  function clearPushTimer(): void {
    if (pushTimer !== null) {
      clearTimeout(pushTimer)
      pushTimer = null
    }
  }

  async function adopt(nodes: LearnNode[], base: LearnNode[]): Promise<void> {
    await replaceLocal(nodes)
    adoptRemote(nodes, base)
  }

  async function upload(target: LearnNode[], attempt: number): Promise<void> {
    const result = await pushNodes({ baseVersion, nodes: target }, fetchImpl)
    if (!result) {
      if (attempt < MAX_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, 2 ** attempt * 500))
        return upload(target, attempt + 1)
      }
      return
    }
    if (result.ok) {
      baseVersion = result.version
      baseNodes = target
      return
    }
    await resolveConflict(target)
  }

  /** 409 之后的主张：拿 base/local/remote 三路合并，采用合并结果并据其重推。 */
  async function resolveConflict(staleTarget: LearnNode[]): Promise<void> {
    const remote = await fetchRemoteNodes(fetchImpl)
    if (!remote || remote.version === baseVersion) return
    const merged = mergeNodes(baseNodes, staleTarget, remote.nodes)
    // 采用的合并结果取代此前一切待传状态，旧快照再传会把远端已删节点复活
    clearPushTimer()
    pendingLocal = null
    await adopt(merged, baseNodes)
    const retry = await pushNodes({ baseVersion: remote.version, nodes: merged }, fetchImpl)
    if (retry?.ok) {
      baseVersion = retry.version
      baseNodes = merged
    }
  }

  function watch(nodes: LearnNode[]): void {
    if (baseVersion < 0) return // 基准尚未对齐，等 start 完成
    pendingLocal = nodes
    clearPushTimer()
    pushTimer = setTimeout(() => {
      pushTimer = null
      const target = pendingLocal ?? getLocal()
      pendingLocal = null
      // 目标与基准一致（如采用远端后回流回来的 watch）：无需上传
      if (deepEqual(target, baseNodes)) return
      uploadChain = uploadChain.then(() => upload(target, 0))
    }, debounceMs)
  }

  async function start(): Promise<void> {
    const remote = await fetchRemoteNodes(fetchImpl)
    if (!remote) return
    if (remote.version === 0) {
      // 空库 + 本端有本地数据：推上去立基准；本端也是空就只立空基准，不空转版本号
      if (getLocal().length > 0) {
        const first = await pushNodes({ baseVersion: 0, nodes: getLocal() }, fetchImpl)
        if (!first?.ok) return
        baseVersion = first.version
        baseNodes = getLocal()
      } else {
        baseVersion = 0
        baseNodes = []
      }
    } else {
      baseVersion = remote.version
      baseNodes = remote.nodes
      // 服务端已有多设备口径：以本端现状为基准硬切到服务端快照
      await adopt(remote.nodes, getLocal())
    }
    pollTimer = setInterval(() => {
      void poll()
    }, POLL_INTERVAL_MS)
  }

  async function poll(): Promise<void> {
    if (baseVersion < 0) return
    const remote = await fetchRemoteNodes(fetchImpl)
    if (!remote || remote.version === baseVersion) return
    // 本地口径优先取待传快照：防抖期内的写入（如刚落库的流式回答）
    // 必须参与合并，否则被远端快照清掉直接丢数据
    const local = pendingLocal ?? getLocal()
    const merged = mergeNodes(baseNodes, local, remote.nodes)
    const previousBase = baseNodes
    baseVersion = remote.version
    baseNodes = remote.nodes
    // 合并结果成为本端最新口径，待传防抖的使命已被合并吸收
    clearPushTimer()
    pendingLocal = null
    // 合并结果与本地一致就不动本地：避免轮询反复触发 UI 替换与落盘
    if (!deepEqual(merged, getLocal())) await adopt(merged, previousBase)
    // 合并结果与远端一致就不回推：无新信息，推只是空转版本号，
    // 还会在多台设备之间造成「你推我推」的版本乒乓
    if (deepEqual(merged, remote.nodes)) return
    uploadChain = uploadChain.then(() => upload(merged, 0))
  }

  function stop(): void {
    clearPushTimer()
    if (pollTimer !== null) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  }

  return { start, watch, poll, stop }
}
