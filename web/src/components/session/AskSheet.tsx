import { useEffect, useRef, useState } from 'react'
import styles from './AskSheet.module.css'

export interface AskSheetProps {
  /** 被选中的原文，钉顶展示——起草全程看得见自己在问哪一段 */
  anchorText: string
  onSubmit(question: string): void
  onCancel(): void
}

/**
 * 手机端追问起草（decisions/2026-11-19 §三.2）：底部弹层，锚点原文钉顶。
 * 单格视口无可见起草位，故以底部弹层承接 planAsk 的起草语义。
 * 形态语义源：备份分支 feature/chat-ui-tools 的 AskSheet.tsx。
 */
export function AskSheet({ anchorText, onSubmit, onCancel }: AskSheetProps) {
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
    <div className={styles.backdrop} data-ask-sheet onClick={onCancel}>
      <div className={styles.sheet} onClick={(event) => event.stopPropagation()}>
        <div className={styles.quote}>
          <span className={styles.label}>就这段提问</span>
          <p className={styles.anchorText}>{anchorText}</p>
        </div>
        <textarea
          ref={inputRef}
          className={styles.input}
          rows={3}
          placeholder="你的问题…"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') onCancel()
            if (event.key !== 'Enter') return
            if (event.nativeEvent.isComposing) return
            if (event.shiftKey) return
            event.preventDefault()
            submit()
          }}
        />
        <div className={styles.actions}>
          <button type="button" className={styles.ghost} onClick={onCancel}>
            取消
          </button>
          <button
            type="button"
            className={styles.primary}
            disabled={trimmed === ''}
            onClick={submit}
          >
            提问
          </button>
        </div>
      </div>
    </div>
  )
}
