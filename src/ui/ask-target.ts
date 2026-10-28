import { latestAnswer, type LearnNode } from '../domain/tree'
import type { AskInput } from '../app/store'
import type { SelectionReading } from './selection'

/**
 * 把「当前节点 + 选中文字」组装成开分支的提问输入。
 * 选区没记录消息 id 时锚定到最新一条回答 —— 落到旧轮次会让分支挂错位置。
 */
export function toAskInput(node: LearnNode, reading: SelectionReading, question: string): AskInput {
  return {
    parentId: node.id,
    messageId: reading.messageId ?? latestAnswer(node)?.id ?? '',
    fragmentIndex: reading.fragmentIndex,
    text: reading.text,
    question,
  }
}
