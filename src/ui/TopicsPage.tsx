import { useState } from 'react'
import { descendantCount, latestAnswer, type LearnNode } from '../domain/tree'
import type { LearnData } from '../app/store'

export interface TopicsPageProps {
  data: LearnData
  onOpen(nodeId: string): void
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

export function TopicsPage({ data, onOpen, onOpenSettings }: TopicsPageProps) {
  const [topic, setTopic] = useState('')
  const roots = data.nodes.filter((node) => node.parentId === null)

  const submit = () => {
    const trimmed = topic.trim()
    if (trimmed === '') return
    setTopic('')
    onOpen(data.createTopic(trimmed))
  }

  return (
    <div className="page">
      <header className="page-head">
        <h1>学习树</h1>
        <button type="button" className="icon-btn" onClick={onOpenSettings} aria-label="设置">
          ⚙
        </button>
      </header>

      <div className="topic-create">
        <textarea
          className="topic-input"
          rows={2}
          placeholder="想学什么？例如：什么是复利"
          value={topic}
          onChange={(event) => setTopic(event.target.value)}
        />
        <button
          type="button"
          className="btn-primary"
          disabled={topic.trim() === ''}
          onClick={submit}
        >
          开始学习
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
          return (
            <li key={node.id} className="topic-row">
              <button type="button" className="topic-item" onClick={() => onOpen(node.id)}>
                <span className="topic-title">{node.messages[0]?.content}</span>
                <span className="topic-preview">{preview(node)}</span>
                <span className="topic-meta">{count > 0 ? `${count} 个分支` : '暂无分支'}</span>
              </button>
              <button
                type="button"
                className="topic-delete"
                aria-label="删除这个学习树"
                onClick={() => {
                  if (window.confirm(`删除「${node.messages[0]?.content}」及其全部追问？`)) {
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
