import { useEffect, useRef, useState } from 'react'

export interface AskSheetProps {
  anchorText: string
  onSubmit(question: string): void
  onCancel(): void
}

/** 提问输入面板：始终展示锚点原文，避免用户忘了自己在问哪一段。 */
export function AskSheet({ anchorText, onSubmit, onCancel }: AskSheetProps) {
  const [question, setQuestion] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const submit = () => {
    const trimmed = question.trim()
    if (trimmed === '') return
    onSubmit(trimmed)
  }

  return (
    <div className="sheet-backdrop" onClick={onCancel}>
      <div className="sheet" onClick={(event) => event.stopPropagation()}>
        <div className="sheet-quote">
          <span className="sheet-quote-label">就这段提问</span>
          <p>{anchorText}</p>
        </div>
        <textarea
          ref={inputRef}
          className="sheet-input"
          rows={3}
          placeholder="你的问题…"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
        />
        <div className="sheet-actions">
          <button type="button" className="btn-ghost" onClick={onCancel}>
            取消
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={question.trim() === ''}
            onClick={submit}
          >
            提问
          </button>
        </div>
      </div>
    </div>
  )
}
