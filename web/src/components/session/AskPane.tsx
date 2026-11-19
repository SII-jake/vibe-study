import { useEffect, useRef, useState } from 'react'
import styles from './AskPane.module.css'

export interface AskPaneProps {
  /** 被选中的原文，固定在顶部——起草全程看得见自己在问哪一段 */
  anchorText: string
  onSubmit(question: string): void
  onCancel(): void
}

/**
 * 右栏起草位（decisions/2026-11-19 §二.4）：桌面选中文字后在这里就地追问，
 * 阅读区保持可见可滚——不做盖住正文的浮层。
 * 形态语义源：备份分支 feature/chat-ui-tools 的 AskPane.tsx。
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
    <div className={styles.pane}>
      <div className={styles.quote}>
        <span className={styles.label}>就这段提问</span>
        <p className={styles.anchorText}>{anchorText}</p>
      </div>

      <textarea
        ref={inputRef}
        className={styles.input}
        rows={4}
        placeholder="针对这一段，你想问什么？"
        value={question}
        onChange={(event) => setQuestion(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onCancel()
          if (event.key !== 'Enter') return
          // 中文输入法在组合中回车是确认合成，不该发送
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
  )
}
