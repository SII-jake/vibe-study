import type { Session, UserMessage } from './types.js'

/**
 * 追问消息的提问本体。追问的 content 是给模型的协议格式
 * （"你在回答中写过这段内容…我的追问：X"），展示一律只呈现 X。
 */
export const askQuestionText = (message: UserMessage): string =>
  message.ask
    ? (message.content.split('我的追问：').at(-1)?.trim() ?? message.content)
    : message.content

/**
 * lane 标题（真机反馈①③，2026-11-22 扩到右栏）：
 * 该层根追问的 ask.title（模型在本轮流尾部生成的短标题）→ 提问本体 →
 * 会话标题兜底（主线根层没有追问，就是会话标题）。
 */
export function laneTitle(
  session: Session,
  laneRootId: string | null,
  fallback: string,
): string {
  if (!laneRootId || laneRootId === session.rootMessageId) {
    return fallback
  }
  const root = session.messages.find((message) => message.id === laneRootId)
  if (root?.role !== 'user') {
    return fallback
  }
  const text = root.ask?.title ?? askQuestionText(root)
  return text.trim() === '' ? fallback : text
}
