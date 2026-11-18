import clsx from 'clsx'
import { useEffect, useRef, useState } from 'react'
import { useIsMobile } from '../../app/viewport.js'
import { useTranslate } from '../../i18n/index.js'
import { askAt } from '../../services/chat/store.js'
import type { Session } from '../../services/chat/types.js'
import { ChatInput } from '../chatInput/ChatInput.js'
import { MessageList } from '../messages/MessageList.js'
import { AskActionBar } from '../messages/AskActionBar.js'
import { AskPopover } from '../messages/AskPopover.js'
import { installContextMenuGuard } from './contextMenuGuard.js'
import { MobileHeader } from './MobileHeader.js'
import styles from './SessionView.module.css'

/** 选中的待追问原文：所在回答 id + 原文 + 选区矩形（操作条锚定用）；选区离开回答正文即清空。 */
type AskSelection = { anchorMessageId: string; anchorText: string; rect: DOMRect }

/** 会话页：标题栏（移动端为顶栏）+ 消息列表，输入框吸底 */
export const SessionView = ({
  session,
  streaming,
  siderCollapsed,
}: {
  session: Session
  streaming: boolean
  siderCollapsed: boolean
}) => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const title = session.title || t('untitledChat')
  const [askSelection, setAskSelection] = useState<AskSelection | null>(null)
  // 输入浮层的开合与暂存的选区分开管理：操作条→浮层是两步，关闭浮层二段式都清
  const [asking, setAsking] = useState(false)
  const askingRef = useRef(false)
  askingRef.current = asking
  // 长按区内的系统 contextmenu 不启动（配合壳 finish 拦截，防系统框"一闪而过"替身）
  useEffect(() => installContextMenuGuard(), [])

  // 选择追问入口（移动端实测重塑）：
  // 选择变化只写入防抖——长按后会紧跟一连串 selectionchange（拖选手柄的轨迹），
  // 停顿 350ms 才亮操作条，避免遮罩在拖选中途盖住手柄导致无法扩选。
  // 浮层出现期间选区必然变化（焦点移动），askingRef 挡住它回写/清空操作条。
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const readAskSelection = (): AskSelection | null => {
      const selection = window.getSelection()
      const text = selection?.toString().trim() ?? ''
      if (!selection || selection.isCollapsed || text === '') return null
      const node =
        selection.anchorNode instanceof Element
          ? selection.anchorNode
          : selection.anchorNode?.parentElement
      const textHost = node?.closest('[data-ask-text]') ?? null
      const messageHost = textHost?.closest('[data-message-id]') ?? null
      if (!textHost || !messageHost) return null
      // 读矩形时机必须在"停顿"判定之后——拖选中 range.getBoundingClientRect 会随手柄轨迹变，
      // 只有在停顿的那一刻取快照，操作条位置才稳。
      const rect = selection.rangeCount > 0 ? selection.getRangeAt(0).getBoundingClientRect() : null
      if (!rect || (rect.width === 0 && rect.height === 0)) return null
      return {
        anchorMessageId: messageHost.getAttribute('data-message-id') ?? '',
        anchorText: text,
        rect,
      }
    }
    const onSelectionChange = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        if (askingRef.current) return
        setAskSelection(readAskSelection())
      }, 350)
    }
    document.addEventListener('selectionchange', onSelectionChange)
    return () => {
      document.removeEventListener('selectionchange', onSelectionChange)
      if (timer) clearTimeout(timer)
    }
  }, [])

  return (
    <div className={styles.view}>
      {isMobile ? (
        <MobileHeader title={title} />
      ) : (
        <div className={styles.header}>
          <div className={clsx(styles.title, siderCollapsed && styles.withCollapsedSider)}>
            {title}
          </div>
        </div>
      )}
      <MessageList
        session={session}
        streaming={streaming}
        footer={
          <div className={styles.inputContainer}>
            <ChatInput sessionId={session.id} />
            <div className={styles.caveat}>{t('contentCaveat')}</div>
          </div>
        }
      />
      {askSelection && !asking ? (
        <AskActionBar
          anchorText={askSelection.anchorText}
          rect={askSelection.rect}
          onAsk={() => setAsking(true)}
          onCopied={() => {
            window.getSelection()?.removeAllRanges()
            setAskSelection(null)
          }}
        />
      ) : null}
      {askSelection && asking ? (
        <AskPopover
          anchorText={askSelection.anchorText}
          // 面板贴着所选内容出现（下方优先；贴底翻上；水平对齐选区中心并留边）
          position={(() => {
            const { rect } = askSelection
            const panelEstimate = { width: 360, height: 190 }
            const belowFits = rect.bottom + 8 + panelEstimate.height < window.innerHeight
            const top = belowFits ? rect.bottom + 8 : rect.top - 8 - panelEstimate.height
            const left = Math.min(
              Math.max(rect.left + rect.width / 2 - panelEstimate.width / 2, 8),
              window.innerWidth - panelEstimate.width - 8,
            )
            return { top, left }
          })()}
          onClose={() => {
            setAsking(false)
            setAskSelection(null)
          }}
          onSubmit={(question) => {
            askAt(session.id, askSelection.anchorMessageId, askSelection.anchorText, question)
            setAsking(false)
            setAskSelection(null)
          }}
        />
      ) : null}
    </div>
  )
}
