import type { LearnNode } from './tree'

export type ChatRole = 'system' | 'user' | 'assistant'

export interface ChatMessage {
  role: ChatRole
  content: string
}

const SYSTEM_PROMPT = [
  '你是一个学习助手，帮助用户顺着自己划出的原文追问。',
  '用户会给出锚点原文与问题。只针对锚点处的这一段内容作答，把这一点讲透。',
  '不要重复或改写整篇原回答，不要提前讲锚点之外的内容。',
  '需要展开时用短段落，避免长篇铺垫。',
].join('')

function withAnchor(question: string, anchorText: string): string {
  return [`关于这段原文：`, `> ${anchorText}`, '', `我的问题：${question}`].join('\n')
}

/** 把根到当前节点的路径拼成对话上下文，子节点的问题附带其锚点原文。 */
export function buildChatMessages(path: LearnNode[]): ChatMessage[] {
  const messages: ChatMessage[] = [{ role: 'system', content: SYSTEM_PROMPT }]
  for (const node of path) {
    node.messages.forEach((message, index) => {
      const isAnchoredQuestion = index === 0 && node.anchor !== null
      messages.push({
        role: message.role,
        content: isAnchoredQuestion ? withAnchor(message.content, node.anchor!.text) : message.content,
      })
    })
  }
  return messages
}
