import type { Message, Session } from './types.js'

/**
 * 以追问分支的根消息为起点，沿 selectedChildId 推导"该追问及其后续"的子对话链
 * （decisions/2026-11-19 §二.4 右栏子对话位的取数入口）。
 * 复用分支视图模型：返回的是把 rootMessageId 换成分支根 id 的 Session（消息全量保留），
 * getVisibleMessages 在其上走出的就是子对话可见链——不发明新遍历。
 * 注意不能裁成只剩可见链：分支卡（AskBranches）要按全量 messages 反查该 lane
 * 内 assistant 消息下挂的下一层追问；裁掉后嵌套追问入口会消失。
 */
export function rootedConversation(
  session: Session,
  rootMessageId: string,
): Session | null {
  // normalizeSession 之外的一切分支形态都满足"rootMessageId 已在 messages 里"
  if (session.rootMessageId === undefined) {
    return null
  }
  const root = session.messages.find((m) => m.id === rootMessageId)
  if (!root) {
    return null
  }
  const rooted: Session = { ...session, rootMessageId }
  return rooted
}

/**
 * lane 祖先链纯计算（decisions/2026-11-19 §二.1 + 附录）：视口状态只存
 * {centerNodeId, rightNodeId} 两个 id；lane 序列从 centerNodeId 沿 ask 锚点
 * 爬到主线根，逐级反推父 lane 的根用户消息——不另发明状态存储。
 * lane 的根消息 = lane 内第一对有锚点的问答对中的 user 提问（ask 锚点所在
 * 消息或主线根）。任一消息都唯一归属某个 lane：从它向上沿 parent 链找
 * 第一个"lane 的根 user"（带 ask 字段的分支提问，或主线根）。
 * 从右栏收起/嵌套下潜时的左移对照全靠这条链。
 */
const laneRootOf = (
  byId: Map<string, Message>,
  sessionRootId: string,
  messageId: string,
): string | null => {
  let cursor: string | null = messageId
  for (let guard = byId.size + 1; guard > 0 && cursor; guard -= 1) {
    const message = byId.get(cursor)
    if (!message) return null
    if (cursor === sessionRootId) return sessionRootId
    if (message.role === 'user' && (message as Message & { ask?: unknown }).ask !== undefined) {
      return cursor
    }
    cursor = message.parentId ?? null
  }
  return null
}

export function laneAncestors(session: Session, centerNodeId: string | null): string[] {
  if (!centerNodeId || !session.rootMessageId) return []
  const byId = new Map(session.messages.map((m) => [m.id, m]))
  const rootId = session.rootMessageId
  const laneIds: string[] = []
  let cursor: string | null = centerNodeId
  for (let guard = byId.size + 1; guard > 0 && cursor; guard -= 1) {
    const laneRoot = laneRootOf(byId, rootId, cursor)
    if (!laneRoot) return []
    laneIds.unshift(laneRoot)
    if (laneRoot === rootId) {
      break
    }
    const laneRootMessage = byId.get(laneRoot)
    const anchorId =
      laneRootMessage?.role === 'user'
        ? (laneRootMessage as Message & { ask?: { anchorMessageId?: string | null } }).ask?.anchorMessageId
        : undefined
    if (!anchorId) return []
    cursor = anchorId
  }
  return laneIds
}
