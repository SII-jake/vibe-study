import { useState } from 'react'
import type { LearnData } from '../app/store'

export interface StartPageProps {
  data: LearnData
  onCreated(nodeId: string): void
  /** 打开会话抽屉（移动端可见） */
  onOpenMenu?(): void
}

const EXAMPLES = ['复利和时间的关系', 'Transformer 的注意力怎么算', '为什么咖啡因会让人睡不着']

/**
 * 还没打开会话时的中栏：欢迎语 + 输入框。
 * 输入框常驻在这里，发出第一句话才创建会话，会话随即出现在左栏。
 */
export function StartPage({ data, onCreated, onOpenMenu }: StartPageProps) {
  const [draft, setDraft] = useState('')

  const submit = () => {
    const trimmed = draft.trim()
    if (trimmed === '') return
    setDraft('')
    onCreated(data.createTopic(trimmed))
  }

  return (
    <div className="page start-page">
      <header className="reader-head">
        {onOpenMenu && (
          <button
            type="button"
            className="icon-btn menu-btn"
            onClick={onOpenMenu}
            aria-label="会话列表"
          >
            ☰
          </button>
        )}
        <div className="reader-crumb">
          <span className="crumb-current">新会话</span>
        </div>
      </header>

      <div className="start-body">
        <div className="start-inner">
          <h2>想学点什么？</h2>
          <p className="hint">直接在下面提问，发出第一句话时才创建会话。</p>
          <div className="example-row">
            {EXAMPLES.map((text) => (
              <button
                key={text}
                type="button"
                className="example-chip"
                onClick={() => setDraft(text)}
              >
                {text}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="follow-bar">
        <textarea
          className="follow-input"
          rows={2}
          placeholder="问点什么…"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault()
              submit()
            }
          }}
        />
        <button
          type="button"
          className="btn-primary follow-send"
          disabled={draft.trim() === ''}
          onClick={submit}
        >
          提问
        </button>
      </div>
    </div>
  )
}
