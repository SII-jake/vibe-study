import { useEffect, useRef, useState } from 'react'

export interface AskPaneProps {
  /** 被选中的原文，固定在顶部，避免用户忘了在问哪一段 */
  anchorText: string
  onSubmit(question: string): void
  onCancel(): void
}

/**
 * 右栏提问框：选中一段文字后在这里就地提问，不再用底部弹窗盖住正文。
 * 与 AskSheet 的区别只在容器形态 —— 它常驻右栏，阅读区保持可见可滚。
 */
export function AskPane({ anchorText, onSubmit, onCancel }: AskPaneProps) {
  const [question, setQuestion] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const trimmed = question.trim()

  const submit = () => {
    if (trimmed === '') return
    onSubmit(trimmed)
  }

  return (
    <div className="ask-pane">
      <div className="ask-pane-quote">
        <span className="ask-pane-label">就这段提问</span>
        <p>{anchorText}</p>
      </div>

      <textarea
        ref={inputRef}
        className="ask-pane-input"
        rows={4}
        placeholder="针对这一段，你想问什么？"
        value={question}
        onChange={(event) => setQuestion(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault()
            submit()
          }
          if (event.key === 'Escape') onCancel()
        }}
      />

      <div className="ask-pane-actions">
        <button type="button" className="btn-ghost" onClick={onCancel}>
          取消
        </button>
        <button type="button" className="btn-primary" disabled={trimmed === ''} onClick={submit}>
          提问
        </button>
      </div>
    </div>
  )
}
