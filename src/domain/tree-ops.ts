import type { LearnNode } from './tree'

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
        { id: `${node.id}-a${node.messages.length}`, role: 'assistant', content, createdAt },
      ],
    }
  })
}

/** 清空节点的全部回答，保留提问；重新生成回答时使用，避免叠加重复回答。 */
export function clearAnswers(nodes: LearnNode[], nodeId: string): LearnNode[] {
  return nodes.map((node) => {
    if (node.id !== nodeId) return node
    return { ...node, messages: node.messages.filter((message) => message.role !== 'assistant') }
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

