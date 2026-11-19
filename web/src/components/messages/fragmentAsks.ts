import type { Session, UserMessage } from '../../services/chat/types.js'

/**
 * 片段级追问引子（decisions/2026-11-19 §二.5 + 第二轮真机反馈修订）：
 * 定位以 anchorText 在块文本内精确匹配为准——存的 fragmentIndex 只是
 * 兼容字段，正文块序漂移（增删块/编排差异）后按索引挂卡必然错位。
 * 匹配不上的记录由渲染层兜底陈列在正文末尾，不再走消息级 AskBranches。
 */

export interface FragmentAskEntry {
  /** 追问分支的根用户消息 id（pane 规则/取链的 nodeId） */
  rootId: string
  /** 引子卡展示文本（真机反馈③）：ask.title（模型生成的追问短标题）
   *  优先；未生成/失败时回退用户那次提问的本体 */
  question: string
  /** 被追的原文——渲染层按它在当前块文本里精确匹配落点 */
  anchorText: string
  /** 同一锚点文本下被追问的次数（引子卡"N 条追问"文案口径） */
  branchCount: number
}

function isAskMessage(message: unknown): message is UserMessage & { ask: { anchorText: string; anchorMessageId: string } } {
  const m = message as UserMessage | undefined
  return m?.role === 'user' && typeof m.ask?.anchorText === 'string' && m.ask.anchorText !== ''
}

/** 该 assistant 消息下挂的全部追问引子（按消息创建序，等价片段内分组由渲染层做）。 */
export function buildFragmentAskList(session: Session, anchorMessageId: string): FragmentAskEntry[] {
  const asks = session.messages.filter(
    (m) => m.parentId === anchorMessageId && isAskMessage(m),
  ) as (UserMessage & { ask: { anchorText: string; title?: string } })[]
  const entries = asks.map((m) => ({
    rootId: m.id,
    question:
      m.ask.title ?? (m.content.split('我的追问：').at(-1)?.trim() ?? m.content),
    anchorText: m.ask.anchorText,
    branchCount: 0,
  }))
  for (const e of entries) {
    e.branchCount = entries.filter((x) => x.anchorText === e.anchorText).length
  }
  return entries
}
