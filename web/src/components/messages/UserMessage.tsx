import { useTranslate } from '../../i18n/index.js'
import clsx from 'clsx'
import { memo, useLayoutEffect, useRef, useState } from 'react'
import { useIsMobile } from '../../app/viewport.js'
import { IconEditOutline16 } from '../base/icons.js'
import { editMessage, retryUpload } from '../../services/chat/store.js'
import { stopReadAloud } from '../../services/speech/readAloud.js'
import type { UserMessage as UserMessageType } from '../../services/chat/types.js'
import { askQuestionText } from '../../services/chat/laneTitle.js'
import { Button } from '../base/Button.js'
import { IconButton } from '../base/IconButton.js'
import { ensureApiKey } from '../settings/settingsDialogState.js'
import {
  BranchSwitcher,
  type MessageVersions,
  type SelectMessageVersion,
} from './BranchSwitcher.js'
import { MessageFile } from './MessageFile.js'
import { CopyButton } from './CopyButton.js'
import styles from './UserMessage.module.css'

export const UserMessage = memo(function UserMessage({
  sessionId,
  laneRootId,
  message,
  retryUploadId,
  isFirst,
  isLast,
  busy,
  versions,
  onSelectVersion,
}: {
  sessionId: string
  /** 追问层编辑重试的路径锚点（真机反馈⑥） */
  laneRootId?: string | null
  message: UserMessageType
  /** 回答因补传附件失败可重试时为该回答 id */
  retryUploadId: string | null
  isFirst: boolean
  isLast: boolean
  busy: boolean
  versions: MessageVersions
  onSelectVersion: SelectMessageVersion
}) {
  const t = useTranslate()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(askQuestionText(message))
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const isMobile = useIsMobile()
  const canSend = !busy && (draft.trim() !== '' || message.files.length > 0)

  useLayoutEffect(() => {
    const textarea = textareaRef.current
    if (editing && textarea) {
      textarea.style.height = 'auto'
      textarea.style.height = `${Math.min(textarea.scrollHeight, 202)}px`
    }
  }, [editing, draft])

  const sendEdit = () => {
    if (canSend && ensureApiKey() && editMessage(sessionId, message.id, draft.trim(), laneRootId)) {
      stopReadAloud()
      setEditing(false)
    }
  }

  return (
    <div className={clsx(styles.container, isFirst && styles.isFirst)}>
      {message.files.length > 0 ? (
        <div
          className={clsx(
            styles.files,
            message.files.some((file) => !file.isImage) && styles.filesWithDocuments
          )}
        >
          {message.files.map((file) => (
            <MessageFile
              key={file.id}
              file={file}
              onRetry={retryUploadId ? () => retryUpload(sessionId, retryUploadId) : null}
            />
          ))}
        </div>
      ) : null}
      {editing ? (
        <div className={styles.editor}>
          <textarea
            ref={textareaRef}
            className={styles.textarea}
            aria-label={t('editMessage')}
            autoFocus
            rows={1}
            value={draft}
            disabled={busy}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) {
                return
              }
              if (event.key === 'Escape') {
                setEditing(false)
              } else if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !isMobile) {
                event.preventDefault()
                sendEdit()
              }
            }}
          />
          <div className={styles.editorActions}>
            <Button size="s" variant="outlined" onClick={() => setEditing(false)}>
              {t('cancel')}
            </Button>
            <Button size="s" disabled={!canSend} onClick={sendEdit}>
              {t('send')}
            </Button>
          </div>
        </div>
      ) : (
        <>
          {/* 追问消息（§二.5 真机反馈）：content 是给模型的协议格式
              （"你在回答中写过这段内容…我的追问：X"），文字泡只呈现问题本体；
              编辑态仍以完整 content 起草，保持"编辑的是真实数据"。 */}
          {message.content ? (
            <div className={styles.bubble}>
              {askQuestionText(message)}
            </div>
          ) : null}
          <div className={styles.bottom}>
            <div className={clsx(styles.actions, isLast && styles.alwaysShow)}>
              {message.content ? <CopyButton text={message.content} /> : null}
              <IconButton
                icon={<IconEditOutline16 />}
                tooltip={t('editMessage')}
                tooltipPlacement="bottom"
                disabled={busy}
                onClick={() => {
                  setDraft(message.content)
                  setEditing(true)
                }}
              />
            </div>
            <BranchSwitcher versions={versions} disabled={busy} onSelect={onSelectVersion} />
          </div>
        </>
      )}
    </div>
  )
})
