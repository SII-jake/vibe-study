/**
 * 会话多端同步（vibe-study：chat-demo 基座接入 /api/nodes 协议）。
 *
 * 映射策略：demo 的 Session 本身是 JSON 可序列化，直接作为 nodes 数组的元素
 * 进出同步——不强套旧 LearnNode 的 title/pathMessages 概念（那已经退役）。
 * 协议不变：baseVersion 乐观锁；远端版本更高采纳、同 id 按 updatedAt 取新。
 * 附件原件（Session.files 的 Blob）不进此通道——那是 demo 始终本地的边界，
 * 多设备的附件同步需要单独的 blob 通道，本次不做。
 *
 * 三处多端一致性缺陷修复（真机反馈 2026-11-22：网页版与手机版没完全同步）：
 * 1) 409 冲突后 baseVersion 不前进，之后每次推送都撞同一个冲突且静默失败 →
 *    冲突时前进基准、并入远端、立即重推一次（自愈）。
 * 2) 删除只删本地，远端还在 → 下次启动又复活。用 deletedIds 集合做墓碑，
 *    合并与启动对齐都按它过滤；推送时存活列表已不含被删项，远端随之清理。
 * 3) 只在启动拉一次，另一端改了看不到 → pullSessions() 供运行期（切回标签页/
 *    窗口聚焦）增量拉取，本地较新的同名会话不被覆盖。
 */
import type { Session } from './types.js'

/** 允许测试注入签名与 Node fetch 对齐的实现。 */
export type SyncFetch = (input: string, init?: RequestInit) => Promise<Response>

/** 同步乐观锁的本地基准（启动时与远端对齐后维护在这里）。 */
let baseVersion = 0
let pushTimer: ReturnType<typeof setTimeout> | null = null
let uploadChain: Promise<void> = Promise.resolve()
/** 尚未触发的防抖任务（flushPush 可直接提前执行它，让测试与切页前冲刷可控）。 */
let pendingTask: { sessions: Session[]; fetchImpl: SyncFetch } | null = null

/**
 * 本地已删除会话的墓碑集合：远端若还留着这些 id，合并时一律忽略，
 * 避免「删掉的会话被别的设备/下次启动的整棵快照又拉回来」。
 * 必须落盘：只在内存里的话，离线删除后刷新页面墓碑就丢了，远端那份会复活。
 */
const DELETED_IDS_KEY = 'chat-demo:deleted-sessions'
/** 墓碑上限：个人自用规模远小于此，超出按插入序丢最旧的，防止无限增长。 */
const DELETED_IDS_LIMIT = 500

const readDeletedIds = (): string[] => {
  try {
    const raw = localStorage.getItem(DELETED_IDS_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

const persistDeletedIds = (ids: Set<string>) => {
  try {
    localStorage.setItem(DELETED_IDS_KEY, JSON.stringify([...ids].slice(-DELETED_IDS_LIMIT)))
  } catch {
    // 存储不可用时只在内存中生效（本次会话内仍然有效）
  }
}

const deletedIds = new Set<string>(readDeletedIds())

export const getSyncBaseVersion = () => baseVersion

/** 标记本地删除：后续合并/对齐都跳过这些 id。 */
export const markSessionDeleted = (id: string) => {
  deletedIds.add(id)
  persistDeletedIds(deletedIds)
}

/** 测试与「清空历史」用：清掉墓碑（全量替换后旧 id 不再有意义）。 */
export const clearDeletedSessions = () => {
  deletedIds.clear()
  persistDeletedIds(deletedIds)
}

/** 当前墓碑快照（只读副本，供合并调用方传入）。 */
export const getDeletedSessionIds = (): ReadonlySet<string> => deletedIds

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

/** 最近一次推送失败的原因（B：失败不再静默）。成功推送后清空。 */
export type SyncFailure = {
  /** too-large = 服务端 413；network = 连接层失败；http = 其它非 2xx */
  reason: 'too-large' | 'network' | 'http' | 'malformed'
  status?: number
  size?: number
  limit?: number
}

let lastSyncFailure: SyncFailure | null = null

export const getLastSyncFailure = (): SyncFailure | null => lastSyncFailure

/** 失败状态变化通知（store 注册后接到界面横幅；纯浏览器环境无副作用） */
let failureListener: ((failure: SyncFailure | null) => void) | null = null

export const setSyncFailureListener = (
  listener: ((failure: SyncFailure | null) => void) | null,
) => {
  failureListener = listener
}

/**
 * 记录并暴露推送失败：修复前一律 `return null` 静默吞掉，远端 "H3多模态推理优化"
 * 会话写入撞 1MB 上限后没有任何痕迹，两端因此长期不一致（真机反馈 2026-11-22）。
 */
function failPush(failure: SyncFailure): null {
  lastSyncFailure = failure
  console.warn('[sync] 会话推送失败', failure)
  failureListener?.(failure)
  return null
}

/**
 * 本地变更 → 全量推送到服务端。失败（网络/非 2xx）不抛，返回 null；
 * 409 冲突返回最新版本号与远端会话，由调用方合并后重推。
 */
export async function pushSessions(
  { baseVersion: base, sessions }: { baseVersion: number; sessions: Session[] },
  fetchImpl: SyncFetch,
): Promise<{ ok: true; version: number } | { ok: false; version: number; sessions: Session[] } | null> {
  let response: Response
  const payload = JSON.stringify({ baseVersion: base, nodes: sessionsToNodes(sessions) })
  try {
    response = await fetchImpl('/api/nodes', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
    })
  } catch {
    return failPush({ reason: 'network', size: payload.length })
  }
  if (response.status === 413) {
    const body = (await response.json().catch(() => null)) as
      | { limit?: number; size?: number }
      | null
    return failPush({
      reason: 'too-large',
      status: 413,
      size: body?.size ?? payload.length,
      limit: body?.limit,
    })
  }
  if (response.status === 409) {
    const body = (await response.json().catch(() => null)) as { version?: number; nodes?: unknown[] } | null
    if (!body || typeof body.version !== 'number') return failPush({ reason: 'malformed', status: 409 })
    return { ok: false, version: body.version, sessions: nodesToSessions(body.nodes ?? []) }
  }
  if (!response.ok) return failPush({ reason: 'http', status: response.status })
  const body = (await response.json().catch(() => null)) as { version?: number } | null
  if (!body || typeof body.version !== 'number') return failPush({ reason: 'malformed', status: response.status })
  lastSyncFailure = null
  failureListener?.(null)
  return { ok: true, version: body.version }
}

/**
 * 启动时一次性对齐：拉远端，与本地合并（同 id 按 updatedAt 取新；本地独有保留独有）。
 * 返回可采纳的会话列表与新基准；网络失败返回 null。
 */
export async function syncOnce(
  {
    localSessions,
    deletedIds: deletedIdsOverride = deletedIds,
  }: { baseVersion: number; localSessions: Session[]; deletedIds?: ReadonlySet<string> },
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
  const merged = mergeSessions(localSessions, remote, deletedIdsOverride)
  baseVersion = body.version
  return { sessions: merged, version: body.version }
}

/**
 * 运行期增量拉取（切回标签页 / 窗口聚焦）：拉远端并与本地合并返回，
 * 不写库——调用方按返回结果决定写哪些会话。网络失败返回 null。
 */
export async function pullSessions(
  {
    localSessions,
    deletedIds: deletedIdsOverride = deletedIds,
  }: { localSessions: Session[]; deletedIds?: ReadonlySet<string> },
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
  const merged = mergeSessions(localSessions, remote, deletedIdsOverride)
  baseVersion = body.version
  return { sessions: merged, version: body.version }
}

/**
 * 会话合并：同 id 按 updatedAt 取新；一方独有直接保留。
 * deletedIds 里的 id 一律丢弃（墓碑优先于远端快照）。
 */
export function mergeSessions(
  local: Session[],
  remote: Session[],
  deletedIds: ReadonlySet<string> = new Set(),
): Session[] {
  const merged = new Map<string, Session>()
  for (const s of local) merged.set(s.id, s)
  for (const s of remote) {
    if (deletedIds.has(s.id)) continue
    const existing = merged.get(s.id)
    if (!existing || s.updatedAt >= existing.updatedAt) merged.set(s.id, s)
  }
  for (const id of deletedIds) merged.delete(id)
  return [...merged.values()]
}

/** 执行一次推送（含 409 自愈重推）。 */
async function runPush(sessions: Session[], fetchImpl: SyncFetch): Promise<void> {
  const pending = mergeSessions(sessions, [], deletedIds)
  const first = await pushSessions({ baseVersion, sessions: pending }, fetchImpl)
  if (!first) return
  if (first.ok) {
    baseVersion = first.version
    return
  }
  // 冲突自愈：基准前移到远端版本，把远端会话并入（本地较新者胜），再推一次。
  baseVersion = first.version
  const healed = mergeSessions(pending, first.sessions, deletedIds)
  const retry = await pushSessions({ baseVersion, sessions: healed }, fetchImpl)
  if (retry?.ok) baseVersion = retry.version
}

/**
 * 变更防抖推送（store.persist 挂点）：合并短时间内的多次修改成一次全量上传。
 * 同一时刻只保留一条上传链；409 冲突时前进基准、并入远端、立即重推一次
 * （修复前：冲突被丢弃，baseVersion 不前进，之后每次推送都撞同一冲突）。
 */
export function schedulePush(sessions: Session[], fetchImpl: SyncFetch, debounceMs = 1500) {
  if (pushTimer) clearTimeout(pushTimer)
  pendingTask = { sessions, fetchImpl }
  pushTimer = setTimeout(() => {
    pushTimer = null
    const task = pendingTask
    pendingTask = null
    if (!task) return
    uploadChain = uploadChain.then(() => runPush(task.sessions, task.fetchImpl))
  }, debounceMs)
}

/** 立即执行尚未触发的防抖推送，并等待所有在飞的推送上链完成（测试/切页前冲刷）。 */
export const flushPush = async (): Promise<void> => {
  if (pendingTask) {
    if (pushTimer) {
      clearTimeout(pushTimer)
      pushTimer = null
    }
    const task = pendingTask
    pendingTask = null
    uploadChain = uploadChain.then(() => runPush(task.sessions, task.fetchImpl))
  }
  await uploadChain
}
