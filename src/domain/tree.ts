/** 问答树：每个节点是一次追问，节点通过锚点挂在父节点某条回答的某个片段上。 */

export type MessageRole = 'user' | 'assistant'

export interface Message {
  id: string
  role: MessageRole
  content: string
  createdAt: number
}

/** 锚点记录完整位置信息，渲染时按原文重新定位，不依赖固定偏移。 */
export interface Anchor {
  /** 父节点中承载锚点的那条消息 */
  messageId: string
  fragmentIndex: number
  text: string
}

export interface LearnNode {
  id: string
  parentId: string | null
  anchor: Anchor | null
  messages: Message[]
  createdAt: number
}

export interface CreateRootInput {
  id: string
  topic: string
  createdAt: number
}

export interface AddChildInput {
  id: string
  parentId: string
  anchor: Anchor
  question: string
  createdAt: number
}

function userMessage(id: string, content: string, createdAt: number): Message {
  return { id, role: 'user', content, createdAt }
}

export function createRootNode(input: CreateRootInput): LearnNode {
  return {
    id: input.id,
    parentId: null,
    anchor: null,
    messages: [userMessage(`${input.id}-m0`, input.topic, input.createdAt)],
    createdAt: input.createdAt,
  }
}

export function addChildNode(input: AddChildInput): LearnNode {
  return {
    id: input.id,
    parentId: input.parentId,
    anchor: input.anchor,
    messages: [userMessage(`${input.id}-m0`, input.question, input.createdAt)],
    createdAt: input.createdAt,
  }
}

/** 从根到指定节点的路径；节点不存在时返回空数组。 */
export function breadcrumb(nodes: LearnNode[], nodeId: string): LearnNode[] {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const path: LearnNode[] = []
  let current = byId.get(nodeId)
  while (current) {
    path.unshift(current)
    current = current.parentId ? byId.get(current.parentId) : undefined
  }
  return path
}

/** 把某节点的子节点按锚点所在片段归组，供回答里逐片段挂引子卡片。 */
export function childrenByFragment(nodes: LearnNode[], parentId: string): Map<number, LearnNode[]> {
  const grouped = new Map<number, LearnNode[]>()
  for (const node of nodes) {
    if (node.parentId !== parentId || !node.anchor) continue
    const bucket = grouped.get(node.anchor.fragmentIndex) ?? []
    bucket.push(node)
    grouped.set(node.anchor.fragmentIndex, bucket)
  }
  return grouped
}

export function descendantCount(nodes: LearnNode[], nodeId: string): number {
  const childrenOf = new Map<string, LearnNode[]>()
  for (const node of nodes) {
    if (!node.parentId) continue
    const bucket = childrenOf.get(node.parentId) ?? []
    bucket.push(node)
    childrenOf.set(node.parentId, bucket)
  }

  let total = 0
  const stack = [...(childrenOf.get(nodeId) ?? [])]
  while (stack.length > 0) {
    const node = stack.pop()
    if (!node) continue
    total += 1
    stack.push(...(childrenOf.get(node.id) ?? []))
  }
  return total
}

/** 节点的最新一条回答；节点只有提问时返回 null。 */
export function latestAnswer(node: LearnNode): Message | null {
  for (let index = node.messages.length - 1; index >= 0; index -= 1) {
    const message = node.messages[index]
    if (message?.role === 'assistant') return message
  }
  return null
}
