import { create } from 'zustand'
import type { TranslationMessage } from '../../i18n/index.js'
import { createId } from '../../utils/id.js'
import {
  cancelUpload,
  isImage,
  resolveMimeType,
  uploadAttachment,
  validateFiles,
  type UploadTask,
} from '../attachments.js'
import type { FileAttachment } from './types.js'

export type DraftAttachment = {
  /** 本地标识，也是 IndexedDB 原件与上传任务的 key */
  id: string
  file: File
  isImage: boolean
  previewUrl: string | null
}

type Draft = { text: string; attachments: DraftAttachment[] }

export const EMPTY_DRAFT: Draft = { text: '', attachments: [] }

/**
 * 草稿键（用户 2026-11-25 报的网页版 bug：右栏输入时中栏输入框同步显示同样内容）。
 * 双栏下同一会话同时挂着多个输入框（中栏 lane 一个、右栏一个）；只按会话分键时
 * 它们读同一份受控草稿，敲一边另一边跟着变。
 *
 * 主线 lane 仍以会话 id 作键——旧草稿与「切 lane 不重置草稿」的原意都不变；
 * 追问 lane 追加 laneRootId 区分。分隔符用 NUL：会话 id 与 lane id 都不可能含它。
 */
export type DraftKey = string | null

export const draftKeyOf = (
  sessionId: string | null,
  laneRootId: string | null = null,
): DraftKey => {
  if (sessionId === null) return null
  return laneRootId === null ? sessionId : `${sessionId}\u0000${laneRootId}`
}

/** 该键是否属于这个会话——清会话草稿时要把它的所有 lane 一起清掉。 */
const keyBelongsTo = (key: DraftKey, sessionId: string | null): boolean => {
  if (sessionId === null) return key === null
  return key === sessionId || (typeof key === 'string' && key.startsWith(`${sessionId}\u0000`))
}

/** 草稿只保存在本次页面的内存中，独立于会话详情缓存；null 是新对话的草稿。 */
export const useDrafts = create<{ drafts: Map<DraftKey, Draft> }>(() => ({
  drafts: new Map(),
}))

export const getDraft = (sessionId: string | null, laneRootId: string | null = null): Draft =>
  useDrafts.getState().drafts.get(draftKeyOf(sessionId, laneRootId)) ?? EMPTY_DRAFT

const updateDraft = (
  sessionId: string | null,
  laneRootId: string | null,
  update: (draft: Draft) => Draft,
) =>
  useDrafts.setState((state) => {
    const key = draftKeyOf(sessionId, laneRootId)
    const draft = update(state.drafts.get(key) ?? EMPTY_DRAFT)
    const drafts = new Map(state.drafts)
    if (draft.text || draft.attachments.length > 0) {
      drafts.set(key, draft)
    } else {
      drafts.delete(key)
    }
    return { drafts }
  })

export const setDraftText = (
  sessionId: string | null,
  text: string,
  laneRootId: string | null = null,
) => updateDraft(sessionId, laneRootId, (draft) => ({ ...draft, text }))

const upload = (attachment: DraftAttachment, apiKey: string) => {
  // 上传任务负责记录错误，输入框的附件卡片展示失败及重试入口。
  void uploadAttachment(
    apiKey,
    attachment.id,
    attachment.file,
    attachment.file.name,
    attachment.isImage
  ).catch(() => {})
}

/** 整批校验通过后才创建预览和开始上传。 */
export const addDraftFiles = (
  sessionId: string | null,
  files: File[],
  apiKey: string,
  laneRootId: string | null = null,
): TranslationMessage | null => {
  if (files.length === 0) {
    return null
  }
  const error = validateFiles(files, getDraft(sessionId, laneRootId).attachments.length)
  if (error) {
    return error
  }
  const added = files.map((file): DraftAttachment => {
    const image = isImage(resolveMimeType(file))
    return {
      id: createId(),
      file,
      isImage: image,
      previewUrl: image ? URL.createObjectURL(file) : null,
    }
  })
  updateDraft(sessionId, laneRootId, (draft) => ({
    ...draft,
    attachments: [...draft.attachments, ...added],
  }))
  added.forEach((attachment) => upload(attachment, apiKey))
  return null
}

export const retryDraftAttachment = (
  sessionId: string | null,
  attachmentId: string,
  apiKey: string,
  laneRootId: string | null = null,
) => {
  const attachment = getDraft(sessionId, laneRootId).attachments.find(
    (item) => item.id === attachmentId,
  )
  if (attachment) {
    upload(attachment, apiKey)
  }
}

/** 发送按钮和实际提交共用规则：有内容，且全部附件已上传成功。 */
export const prepareDraftMessage = (draft: Draft, tasks: Record<string, UploadTask>) => {
  const text = draft.text.trim()
  if (!text && draft.attachments.length === 0) {
    return null
  }
  const files: (FileAttachment & { serverId: string; blob: Blob })[] = []
  for (const attachment of draft.attachments) {
    const task = tasks[attachment.id]
    if (task?.status !== 'done' || !task.serverId) {
      return null
    }
    files.push({
      id: attachment.id,
      serverId: task.serverId,
      name: attachment.file.name,
      size: attachment.file.size,
      isImage: attachment.isImage,
      mimeType: resolveMimeType(attachment.file),
      blob: attachment.file,
    })
  }
  return { text, files }
}

const releaseAttachment = (attachment: DraftAttachment, cancel: boolean) => {
  if (cancel) {
    cancelUpload(attachment.id)
  }
  if (attachment.previewUrl) {
    URL.revokeObjectURL(attachment.previewUrl)
  }
}

export const removeDraftAttachment = (
  sessionId: string | null,
  attachmentId: string,
  laneRootId: string | null = null,
) => {
  const attachment = getDraft(sessionId, laneRootId).attachments.find(
    (item) => item.id === attachmentId,
  )
  if (!attachment) {
    return
  }
  releaseAttachment(attachment, true)
  updateDraft(sessionId, laneRootId, (draft) => ({
    ...draft,
    attachments: draft.attachments.filter((item) => item.id !== attachmentId),
  }))
}

/** 发送成功后原件与 serverId 已交给会话，释放预览但保留上传完成态。 */
export const clearSentDraft = (sessionId: string | null, laneRootId: string | null = null) => {
  getDraft(sessionId, laneRootId).attachments.forEach((attachment) =>
    releaseAttachment(attachment, false),
  )
  updateDraft(sessionId, laneRootId, () => EMPTY_DRAFT)
}

/** 删除会话或替换历史成功后，释放尚未发送的草稿及上传任务——该会话所有 lane 一起清。 */
export const clearDraft = (sessionId: string | null) => {
  const { drafts } = useDrafts.getState()
  for (const [key, draft] of drafts) {
    if (!keyBelongsTo(key, sessionId)) continue
    draft.attachments.forEach((attachment) => releaseAttachment(attachment, true))
  }
  useDrafts.setState((state) => {
    const next = new Map(state.drafts)
    for (const key of next.keys()) {
      if (keyBelongsTo(key, sessionId)) next.delete(key)
    }
    return { drafts: next }
  })
}

export const clearAllDrafts = () => {
  for (const draft of useDrafts.getState().drafts.values()) {
    draft.attachments.forEach((attachment) => releaseAttachment(attachment, true))
  }
  useDrafts.setState({ drafts: new Map() })
}
