import type { Session, UserMessage } from '../../services/chat/types.js'
import styles from './AskBranches.module.css'

/**
 * 并列分支区（vibe-study 学习树语义）：
 * 一条回答下被选中追问过的每段原文，并排陈列追问卡片——
 * 锚点原文作引子、追问作主体，点开即切到该分支继续对话。
 *
 * 与 demo 的 BranchSwitcher 分工：切换器服务"同一槽位的版本"（重新生成），
 * 这里服务"并列探索的多条路径"（同级追问），两者共存互不替代。
 * 非追问型子消息（regenerate/edit 的版本）不进本区。
 */

function isAskMessage(message: unknown): message is UserMessage & { ask: { anchorText: string; anchorMessageId: string } } {
  const m = message as UserMessage | undefined
  return m?.role === 'user' && typeof m.ask?.anchorText === 'string' && m.ask.anchorText !== ''
}

export function AskBranches({
  session,
  parentId,
  onOpen,
}: {
  session: Session
  parentId: string
  onOpen: (messageId: string) => void
}) {
  const asks = session.messages.filter(
    (m) => m.parentId === parentId && isAskMessage(m),
  ) as (UserMessage & { ask: { anchorText: string; anchorMessageId: string } })[]
  if (asks.length === 0) return null
  return (
    <div className={styles.branches}>
      {asks.map((m) => (
        <button
          key={m.id}
          type="button"
          data-ask-card
          className={styles.card}
          onClick={() => onOpen(m.id)}
        >
          <span className={styles.anchor}>“{m.ask.anchorText}”</span>
          <span className={styles.question}>
            {m.content.split('我的追问：').at(-1)?.trim() ?? m.content}
          </span>
        </button>
      ))}
    </div>
  )
}
