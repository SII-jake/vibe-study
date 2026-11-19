import { useEffect, useRef, useState } from 'react'
import styles from './AskPopover.module.css'

/**
 * 选择追问面板（内嵌形态，用户实测反馈后从全屏遮罩改回）：
 * 展示所选原文+输入追问，position 由外层按选区矩形锚定——
 * 面板贴着正文内容出现，对话不被遮罩隔开（与旧 AskSheet 的内嵌语义对齐）。
 * 回车即提交（中文输入法合成中不拦截，见 docs/risks/frontend-risks.md 的 IME 条目），
 * Shift+Enter 换行；Esc 或点面板外关闭。
 */
export function AskPopover({
  anchorText,
  position,
  onSubmit,
  onClose,
}: {
  anchorText: string
  position?: { top: number; left: number }
  onSubmit: (question: string) => void
  onClose: () => void
}) {
  const [text, setText] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  const submit = () => {
    const question = text.trim()
    if (question === '') return
    onSubmit(question)
  }

  return (
    // 无遮罩：layer 只做点外关闭的事件捕获，面板以 position（不传时取 DS 移动端默认底部）
    // 锚定在内容旁——使用时正文和所选文字始终可见
    <div className={styles.layer} onClick={onClose}>
      <div
        className={styles.popover}
        data-ask-panel
        // 锚定时必须撤销样式基的居底形态（transform: translateX(-50%) 会把面板左移
        // 半宽，选区靠左时左半边飞出视口——手机实测缺陷；bottom 同理须复位）
        style={position ? { top: position.top, left: position.left, transform: 'none', bottom: 'auto' } : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.anchor}>“{anchorText}”</div>
        <textarea
          ref={textareaRef}
          className={styles.input}
          placeholder="就这段内容追问…"
          value={text}
          rows={2}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // IME 合成中的 Enter 是确认候选词，不是提交（前端红线：独立判断，先于修饰键）
            if (e.nativeEvent.isComposing) return
            if (e.key === 'Escape') {
              e.preventDefault()
              onClose()
              return
            }
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              submit()
            }
          }}
        />
        <div className={styles.actions}>
          <button type="button" className={styles.submit} data-ask-submit onClick={submit}>
            追问
          </button>
        </div>
      </div>
    </div>
  )
}
