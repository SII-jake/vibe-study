import { getVisibleMessages } from '../../services/chat/branches.js'
import { askQuestionText } from '../../services/chat/laneTitle.js'
import { rootedConversation } from '../../services/chat/rootedConversation.js'
import type { Message, Session } from '../../services/chat/types.js'
import { buildFragmentAskList } from './fragmentAsks.js'

/**
 * 追问树（decisions/2026-11-25-ask-tree-navigator.md）。
 *
 * 追问在数据上本来就是一棵树（每条追问挂到锚点消息下，回答上可再追问），
 * 但视图只能沿引子卡/下划线单向进入，追问一多就找不回之前的分支。
 * 这里把树派生出来供导航面板浏览与跳转——纯计算，不碰存储、不改服务端。
 *
 * 节点 = 追问分支的根用户消息（lane 根），根节点是主线对话本身。
 * 子节点的取法与右栏/引子卡完全同一口径（不定新遍历）：
 *   lane(X) 的可见 assistant 消息 → buildFragmentAskList → 各追问 rootId
 */
export interface AskTreeNode {
  /** 追问分支的根用户消息 id；根节点是主线根消息 */
  id: string
  /** 面板行标题：ask.title → 提问本体（与 laneTitle 同口径）；根节点是会话标题 */
  title: string
  /** 该追问所锚的原文片段；主线根为 null */
  anchorText: string | null
  /** 层深：主线根 0，第一层追问 1，以此类推 */
  depth: number
  children: AskTreeNode[]
  /** 挂载点已不在任何可见链上（真机语境"沉底追问"），扁平陈列在树尾 */
  orphan?: boolean
}

export interface AskTree {
  root: AskTreeNode
  /** 挂在已脱离可见链的回答之下、因而遍历不到的追问 */
  orphans: AskTreeNode[]
  /** 追问节点总数（不含主线根） */
  total: number
}

/** 追问挂载点：user 提问且带 ask 三元组（与 branches.isAskMount 同判据）。 */
const isAskMount = (message: Message): boolean =>
  message.role === 'user' &&
  (message as Message & { ask?: { anchorText?: string } }).ask?.anchorText !== undefined

/**
 * 会话里是否有任何追问分支（标题行是否显示「追问树」入口的判据）。
 * 比 buildAskTree 便宜得多——入口每帧都要判，不该为了显示一个按钮去遍历全树。
 */
export const hasAskBranches = (session: Session): boolean =>
  session.messages.some(isAskMount)

/**
 * 某 lane 根下直接挂的第一层追问。
 * 只取可见链上的 assistant 消息——与引子卡的陈列面一致；被编辑替换掉的
 * 旧回答不在可见链上，其追问由 buildAskTree 收进 orphans，不从树上消失。
 */
function firstLevelAsks(
  session: Session,
  laneRootId: string,
): Array<{ id: string; title: string; anchorText: string }> {
  const rooted = rootedConversation(session, laneRootId)
  if (!rooted) return []
  const entries = getVisibleMessages(rooted)
    .filter((message) => message.role === 'assistant')
    .flatMap((message) => buildFragmentAskList(session, message.id))
  return entries.map((entry) => ({
    id: entry.rootId,
    title: entry.question,
    anchorText: entry.anchorText,
  }))
}

/**
 * 派生整棵追问树。O(节点数 × 该层可见链长)——面板按需调用，不参与流式渲染。
 * visited 兼作环保护：坏数据（parentId 成环）时最多把每条追问访问一次。
 */
export function buildAskTree(session: Session, fallbackTitle: string): AskTree {
  const rootId = session.rootMessageId ?? null
  const root: AskTreeNode = {
    id: rootId ?? '',
    title: fallbackTitle,
    anchorText: null,
    depth: 0,
    children: [],
  }
  if (rootId === null) {
    return { root, orphans: [], total: 0 }
  }
  const visited = new Set<string>()

  const childrenOf = (laneRootId: string, parentDepth: number): AskTreeNode[] => {
    const nodes: AskTreeNode[] = []
    for (const ask of firstLevelAsks(session, laneRootId)) {
      // 同一追问可能被两条路径枚举到，visited 保证只出现一次
      if (visited.has(ask.id)) continue
      visited.add(ask.id)
      const node: AskTreeNode = {
        id: ask.id,
        title: ask.title,
        anchorText: ask.anchorText,
        depth: parentDepth + 1,
        children: [],
      }
      node.children = childrenOf(node.id, node.depth)
      nodes.push(node)
    }
    return nodes
  }

  root.children = childrenOf(rootId, 0)

  // 沉底追问：记录还在 messages 里，但挂载点已不在任何可见链上，树遍历不到。
  // 宁可扁平陈列也不让入口消失——用户找的往往正是这类"当时没追完"的分支。
  const orphans: AskTreeNode[] = []
  for (const message of session.messages) {
    if (!isAskMount(message) || visited.has(message.id)) continue
    visited.add(message.id)
    const ask = (message as Message & { ask: { anchorText: string; title?: string } }).ask
    const node: AskTreeNode = {
      id: message.id,
      title: ask.title ?? askQuestionText(message as never),
      anchorText: ask.anchorText,
      depth: 0,
      children: [],
      orphan: true,
    }
    node.children = childrenOf(node.id, 0).map(markOrphan)
    orphans.push(node)
  }

  return { root, orphans, total: visited.size }
}

const markOrphan = (node: AskTreeNode): AskTreeNode => ({
  ...node,
  orphan: true,
  children: node.children.map(markOrphan),
})

/** 根到目标节点的 id 链（含两端）；找不到返回空数组。 */
export function askTreePath(tree: AskTree, nodeId: string): string[] {
  const search = (node: AskTreeNode, trail: string[]): string[] | null => {
    const next = [...trail, node.id]
    if (node.id === nodeId) return next
    for (const child of node.children) {
      const found = search(child, next)
      if (found) return found
    }
    return null
  }
  const inRoot = search(tree.root, [])
  if (inRoot) return inRoot
  for (const orphan of tree.orphans) {
    const found = search(orphan, [])
    if (found) return found
  }
  return []
}

export interface AskTreeRow {
  node: AskTreeNode
  depth: number
  hasChildren: boolean
  /** 本行子节点是否已铺开 */
  expanded: boolean
  orphan: boolean
  /** 是否当前所在位置 */
  current: boolean
}

/**
 * 拍平成可渲染的行（深度优先）。
 * 展开只看 expanded 集合——默认值由 defaultExpandedOf 给出（含当前路径），
 * 但用户显式「全部折叠」时就该真的全折叠，不由函数偷偷把路径撑开。
 */
export function flattenAskTree(
  tree: AskTree,
  expanded: ReadonlySet<string>,
  currentId: string | null,
): AskTreeRow[] {
  const rows: AskTreeRow[] = []
  const walk = (node: AskTreeNode, orphan: boolean) => {
    const hasChildren = node.children.length > 0
    const open = hasChildren && expanded.has(node.id)
    rows.push({
      node,
      depth: node.depth,
      hasChildren,
      expanded: open,
      orphan,
      current: currentId !== null && node.id === currentId,
    })
    if (!open) return
    for (const child of node.children) walk(child, orphan)
  }
  walk(tree.root, false)
  for (const orphan of tree.orphans) walk(orphan, true)
  return rows
}

/** 面板默认展开集合：当前路径上除叶子外的祖先（叶子无需展开）。 */
export function defaultExpandedOf(tree: AskTree, currentId: string | null): Set<string> {
  if (currentId === null) return new Set()
  return new Set(askTreePath(tree, currentId))
}

/** 全部可展开节点 id（「全部展开」用）。 */
export function expandableIdsOf(tree: AskTree): string[] {
  const ids: string[] = []
  const walk = (node: AskTreeNode) => {
    if (node.children.length === 0) return
    ids.push(node.id)
    for (const child of node.children) walk(child)
  }
  walk(tree.root)
  for (const orphan of tree.orphans) walk(orphan)
  return ids
}
