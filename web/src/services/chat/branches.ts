import type { Message, Session } from './types.js'

/** 将线性消息列表规范化为单分支，保留消息 ID、内容及时间。 */
export const normalizeSession = (session: Session): Session =>
  session.rootMessageId !== undefined
    ? session
    : {
        ...session,
        rootMessageId: session.messages[0]?.id ?? null,
        messages: session.messages.map((message, index, messages) => ({
          ...message,
          parentId: messages[index - 1]?.id ?? null,
          selectedChildId: messages[index + 1]?.id,
        })),
      }

/** 展示内容与请求上下文共用当前选中的分支路径。 */
export const getVisibleMessages = (session: Session): Message[] => {
  if (session.rootMessageId === undefined) {
    return session.messages
  }
  const byId = new Map(session.messages.map((message) => [message.id, message]))
  const path: Message[] = []
  let id = session.rootMessageId
  let first = true
  while (id) {
    const message = byId.get(id)
    if (!message) {
      break
    }
    // 追问分支挂载点（decisions/2026-11-19 §二.6）：沿 selectedChildId 误入追问
    // 分支时在本挂载点截断。lane 根本身是追问分支根（嵌套追问的 lane）除外——
    // 那一 lane 的取链入口就是它，不能不收。
    if (!first && isAskMount(message)) {
      break
    }
    path.push(message)
    byId.delete(id)
    first = false
    id = message.selectedChildId ?? null
  }
  return path
}

/** 追问分支挂载点：user 提问且带 ask 字段（锚点三元组所在消息）。 */
const isAskMount = (message: Message): boolean =>
  message.role === 'user' && (message as Message & { ask?: unknown }).ask !== undefined

export type MessageVersions = { ids: string[]; index: number }

/** 一次遍历收集兄弟版本；版本列表未变化时复用旧对象与索引，避免流式正文更新重绘历史消息。 */
export const buildMessageVersions = (
  session: Session,
  previous: ReadonlyMap<string, MessageVersions>
): ReadonlyMap<string, MessageVersions> => {
  const groups = new Map<string | null | undefined, string[]>()
  for (const message of session.messages) {
    // 版本=同父同角色的兄弟分支（decisions/2026-11-19 真机反馈）：
    // 追问 user 消息与其追问回答 assistant 共享 parentId 是分支结构（§二.6），
    // 不是"同一条消息的不同版"——按角色分键后追问不再与主线回答凑成 <2/2>。
    // 追问挂载点（带 ask 的 user 消息）进一步独占单元素组（第二轮真机反馈④）：
    // 它与主线下一问同 parentId 同 role，按角色分键仍会同组挂出 <2/2>——
    // 追问是分支入口（靠引子卡陈列），不是主线问题的"另一个版本"。
    // 独占组 ids.length=1，BranchSwitcher 不渲染；消息仍进 versions map，
    // 保证 buildMessageVersions 的 unchanged 计数口径不被破坏。
    const key =
      session.rootMessageId === undefined
        ? message.id
        : isAskMount(message)
          ? `ask:${message.id}`
          : `${message.parentId}:${message.role}`
    const ids = groups.get(key)
    if (ids) {
      ids.push(message.id)
    } else {
      groups.set(key, [message.id])
    }
  }

  const versions = new Map<string, MessageVersions>()
  let unchanged = previous.size === session.messages.length
  for (const ids of groups.values()) {
    const firstId = ids[0]
    if (firstId === undefined) continue
    const cachedIds = previous.get(firstId)?.ids
    const stableIds =
      cachedIds?.length === ids.length && ids.every((id, index) => id === cachedIds[index])
        ? cachedIds
        : ids
    ids.forEach((id, index) => {
      const cached = previous.get(id)
      const version =
        cached?.ids === stableIds && cached.index === index ? cached : { ids: stableIds, index }
      versions.set(id, version)
      if (version !== cached) {
        unchanged = false
      }
    })
  }
  return unchanged ? previous : versions
}

/** 新消息挂在指定父节点下，并选择新分支；原节点与其后续对话保持不变。 */
export const appendBranch = (
  original: Session,
  parentId: string | null,
  messages: Message[]
): Session => {
  const session = normalizeSession(original)
  const first = messages[0]
  if (!first) {
    return session
  }
  // decisions/2026-11-19 §二.6：追问的问答不占中栏正文。
  // ask 分支（追问）靠 ask 字段反查（AskBranches 路径），不需要也不应能被
  // 父节点 selectedChildId 顶进主线；普通版本追加仍改选父节点到新子。
  const isAskBranch = (first as Message & { ask?: unknown }).ask !== undefined
  return {
    ...session,
    rootMessageId: parentId === null ? first.id : session.rootMessageId,
    messages: [
      ...session.messages.map((message) =>
        message.id === parentId && !isAskBranch ? { ...message, selectedChildId: first.id } : message
      ),
      ...messages.map((message, index) => ({
        ...message,
        parentId: messages[index - 1]?.id ?? parentId,
        selectedChildId: messages[index + 1]?.id,
      })),
    ],
  }
}

/** 仅允许切换当前路径上某一节点的兄弟版本，恢复该版本已选中的后续分支。 */
export const selectVersion = (original: Session, messageId: string): Session => {
  const session = normalizeSession(original)
  const message = session.messages.find((item) => item.id === messageId)
  if (!message || !getVisibleMessages(session).some((item) => item.parentId === message.parentId)) {
    return original
  }
  return {
    ...session,
    rootMessageId: message.parentId === null ? message.id : session.rootMessageId,
    messages: session.messages.map((item) =>
      item.id === message.parentId ? { ...item, selectedChildId: message.id } : item
    ),
  }
}
