import { nodeLabel, type LearnNode } from '../domain/tree'

export interface AskCardProps {
  node: LearnNode
  branchCount: number
  onOpen(nodeId: string): void
}

/** 挂在片段下方的引子：点开才进入分支，避免在手机上层层缩进。 */
export function AskCard({ node, branchCount, onOpen }: AskCardProps) {
  const question = nodeLabel(node)
  return (
    <button type="button" className="ask-card" onClick={() => onOpen(node.id)}>
      <span className="ask-card-mark">💬</span>
      <span className="ask-card-question">{question}</span>
      <span className="ask-card-meta">
        {branchCount > 0 ? `${branchCount} 条追问` : '已问'}
        <span className="ask-card-arrow">›</span>
      </span>
    </button>
  )
}
