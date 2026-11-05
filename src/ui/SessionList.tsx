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
        <h1>
          <button type="button" className="brand-btn" data-brand onClick={onNewSession}>
            vibe study
          </button>
        </h1>
        <button type="button" className="icon-btn" onClick={onOpenSettings} aria-label="设置">
          {/*
           * 内联 SVG 齿轮：⚙ 字符依赖系统字体，Android 上细瘦易变体；
           * 上一版辐条式被实测认成「太阳」——换成 Heroicons cog outline：
           * 8 齿描边轮廓 + 中央描边圆孔，设置图标的事实标准渲染。
           */}
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
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
