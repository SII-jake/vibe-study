import { descendantCount, latestAnswer, nodeLabel, type LearnNode } from '../domain/tree'
import type { LearnData } from '../app/store'

export interface SessionListProps {
  data: LearnData
  /** 当前打开会话的根节点 id，用于高亮；未打开时为 null */
  activeRootId: string | null
  onOpen(nodeId: string): void
  /** 回到「新会话」起始页；输入框常驻中栏，不在左栏 */
  onNewSession(): void
  onOpenSettings(): void
}

function preview(node: LearnNode): string {
  const answer = latestAnswer(node)
  if (!answer) return '还没有回答'
  const text = answer.content
    .replace(/[#>*`|-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return text.slice(0, 60)
}

/**
 * 会话列表：只列会话与切换。
 * 新建会话的输入框不在这里 —— 它常驻中栏，发出第一句话时才建会话。
 */
export function SessionList({
  data,
  activeRootId,
  onOpen,
  onNewSession,
  onOpenSettings,
}: SessionListProps) {
  const roots = data.nodes.filter((node) => node.parentId === null)

  return (
    <div className="session-list">
      <header className="session-head">
        <h1>vibe study</h1>
        <button type="button" className="icon-btn" onClick={onOpenSettings} aria-label="设置">
          ⚙
        </button>
      </header>

      <div className="session-actions">
        <button type="button" className="new-session-btn" onClick={onNewSession}>
          ＋ 新会话
        </button>
      </div>

      {data.ready && roots.length === 0 && (
        <div className="empty-block">
          <p>还没有学习主题。</p>
          <button type="button" className="btn-ghost" onClick={() => void data.seedDemo()}>
            载入示例（复利）
          </button>
        </div>
      )}

      <ul className="topic-list">
        {roots.map((node) => {
          const count = descendantCount(data.nodes, node.id)
          const active = node.id === activeRootId
          return (
            <li key={node.id} className="topic-row">
              <button
                type="button"
                className={`topic-item ${active ? 'topic-active' : ''}`}
                onClick={() => onOpen(node.id)}
              >
                <span className="topic-title">{nodeLabel(node)}</span>
                <span className="topic-preview">{preview(node)}</span>
                <span className="topic-meta">{count > 0 ? `${count} 个分支` : '暂无分支'}</span>
              </button>
              <button
                type="button"
                className="topic-delete"
                aria-label="删除这个主题"
                onClick={() => {
                  if (window.confirm(`删除「${nodeLabel(node)}」及其全部追问？`)) {
                    data.remove(node.id)
                  }
                }}
              >
                ×
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
