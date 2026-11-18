/**
 * 会话多端同步（vibe-study：chat-demo 基座接入 /api/nodes 协议）。
 *
 * 映射策略：demo 的 Session 本身是 JSON 可序列化，直接作为 nodes 数组的元素
 * 进出同步——不强套旧 LearnNode 的 title/pathMessages 概念（那已经退役）。
 * 协议不变：baseVersion 乐观锁；远端版本更高采纳、同 id 按 updatedAt 取新。
 * 附件原件（Session.files 的 Blob）不进此通道——那是 demo 始终本地的边界，
 * 多设备的附件同步需要单独的 blob 通道，本次不做。
 */
import type { Session } from './types.js'

/** 允许测试注入签名与 Node fetch 对齐的实现。 */
export type SyncFetch = (input: string, init?: RequestInit) => Promise<Response>

/** 同步乐观锁的本地基准（启动时与远端对齐后维护在这里）。 */
let baseVersion = 0
let pushTimer: ReturnType<typeof setTimeout> | null = null
let uploadChain: Promise<void> = Promise.resolve()

export const getSyncBaseVersion = () => baseVersion

const isSessionShape = (value: unknown): value is Session => {
  const s = value as Partial<Session> | null
  return (
    typeof s === 'object' &&
    s !== null &&
    typeof s.id === 'string' &&
    typeof s.title === 'string' &&
    typeof s.updatedAt === 'number' &&
    Array.isArray(s.messages)
  )
}

/** Session[] → /api/nodes 通用 JSON 数组：每个会话是数组里的独立元素。 */
export const sessionsToNodes = (sessions: Session[]): unknown[] => sessions

/** /api/nodes 数组 → Session[]：过滤出健康会话形状，其他元素丢弃。 */
export const nodesToSessions = (nodes: unknown[]): Session[] =>
  Array.isArray(nodes) ? nodes.filter(isSessionShape) : []

/**
 * 本地变更 → 全量推送到服务端。失败（网络/非 2xx）不抛，返回 null；
 * 409 冲突返回最新版本号与远端会话，由调用方合并后重推。
 */
export async function pushSessions(
  { baseVersion: base, sessions }: { baseVersion: number; sessions: Session[] },
  fetchImpl: SyncFetch,
): Promise<{ ok: true; version: number } | { ok: false; version: number; sessions: Session[] } | null> {
  let response: Response
  try {
    response = await fetchImpl('/api/nodes', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseVersion: base, nodes: sessionsToNodes(sessions) }),
    })
  } catch {
    return null
  }
  if (response.status === 409) {
    const body = (await response.json().catch(() => null)) as { version?: number; nodes?: unknown[] } | null
    if (!body || typeof body.version !== 'number') return null
    return { ok: false, version: body.version, sessions: nodesToSessions(body.nodes ?? []) }
  }
  if (!response.ok) return null
  const body = (await response.json().catch(() => null)) as { version?: number } | null
  if (!body || typeof body.version !== 'number') return null
  return { ok: true, version: body.version }
}

/**
 * 启动时一次性对齐：拉远端，与本地合并（同 id 按 updatedAt 取新；本地独有保留独有）。
 * 返回可采纳的会话列表与新基准；网络失败返回 null。
 */
export async function syncOnce(
  { localSessions }: { baseVersion: number; localSessions: Session[] },
  fetchImpl: SyncFetch,
): Promise<{ sessions: Session[]; version: number } | null> {
  let response: Response
  try {
    response = await fetchImpl('/api/nodes')
  } catch {
    return null
  }
  if (!response.ok) return null
  const body = (await response.json().catch(() => null)) as { version?: number; nodes?: unknown[] } | null
  if (!body || typeof body.version !== 'number') return null
  const remote = nodesToSessions(body.nodes ?? [])
  const merged = mergeSessions(localSessions, remote)
  baseVersion = body.version
  return { sessions: merged, version: body.version }
}

/** 会话合并：同 id 按 updatedAt 取新；一方独有直接保留。 */
export function mergeSessions(local: Session[], remote: Session[]): Session[] {
  const merged = new Map<string, Session>()
  for (const s of local) merged.set(s.id, s)
  for (const s of remote) {
    const existing = merged.get(s.id)
    if (!existing || s.updatedAt >= existing.updatedAt) merged.set(s.id, s)
  }
  return [...merged.values()]
}

/**
 * 变更防抖推送（store.persist 挂点）：合并短时间内的多次修改成一次全量上传。
 * 同一时刻只保留一条上传链，409 冲突由调用方在下一轮 syncOnce 对齐。
 */
export function schedulePush(sessions: Session[], fetchImpl: SyncFetch, debounceMs = 1500) {
  if (pushTimer) clearTimeout(pushTimer)
  pushTimer = setTimeout(() => {
    pushTimer = null
    uploadChain = uploadChain.then(async () => {
      const result = await pushSessions({ baseVersion, sessions }, fetchImpl)
      if (result?.ok) baseVersion = result.version
    })
  }, debounceMs)
}

/** 测试工具：等待在飞的防抖推送落地。 */
export const flushPush = () => uploadChain
