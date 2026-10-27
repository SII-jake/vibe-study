import type { LearnNode } from './tree'

/** 同节点再追问：不带锚点，消息留在该节点顺排，不新开分支。 */
export function appendUserMessage(
  nodes: LearnNode[],
  nodeId: string,
  content: string,
  createdAt: number,
): LearnNode[] {
  return nodes.map((node) => {
    if (node.id !== nodeId) return node
    return {
      ...node,
      messages: [
        ...node.messages,
        { id: `${node.id}-u${node.messages.length}`, role: 'user' as const, content, createdAt },
      ],
    }
  })
}

/** 追加一条回答消息；节点不存在时原样返回。 */
export function appendAnswer(
  nodes: LearnNode[],
  nodeId: string,
  content: string,
  createdAt: number,
): LearnNode[] {
  return nodes.map((node) => {
    if (node.id !== nodeId) return node
    return {
      ...node,
      messages: [
        ...node.messages,
        { id: `${node.id}-a${node.messages.length}`, role: 'assistant' as const, content, createdAt },
      ],
    }
  })
}

/** 清空节点的最后一条回答；重建或中止流式时用，不动其它轮次与其它节点。 */
export function clearLastAnswer(nodes: LearnNode[], nodeId: string): LearnNode[] {
  return nodes.map((node) => {
    if (node.id !== nodeId) return node
    let lastAssistant = -1
    node.messages.forEach((message, index) => {
      if (message.role === 'assistant') lastAssistant = index
    })
    if (lastAssistant < 0) return node
    return { ...node, messages: node.messages.filter((_, index) => index !== lastAssistant) }
  })
}

/** 删除节点及其全部后代；节点不存在时原样返回。 */
export function removeSubtree(nodes: LearnNode[], nodeId: string): LearnNode[] {
  if (!nodes.some((node) => node.id === nodeId)) return nodes

  const doomed = new Set<string>([nodeId])
  let changed = true
  while (changed) {
    changed = false
    for (const node of nodes) {
      if (node.parentId && doomed.has(node.parentId) && !doomed.has(node.id)) {
        doomed.add(node.id)
        changed = true
      }
    }
  }
  return nodes.filter((node) => !doomed.has(node.id))
}
