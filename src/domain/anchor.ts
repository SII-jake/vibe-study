import { type Fragment, toPlainText } from './fragment'
import { locateRange } from './text-match'

/** 选中的一段话是提问锚点：片段序号用于快速定位，原文用于渲染失败时回退搜索。 */
export interface AnchorRef {
  fragmentIndex: number
  text: string
}

export interface ResolvedAnchor {
  fragmentIndex: number
  /** 相对片段纯文本的起始位置 */
  offset: number
}

/**
 * 把锚点解析成当前片段集合中的位置。
 * 片段序号失效（回答被改写）时按原文全局搜索；原文也不存在时返回 null，由调用方降级展示。
 */
export function resolveAnchor(fragments: Fragment[], anchor: AnchorRef): ResolvedAnchor | null {
  const target = toPlainText(anchor.text)
  if (target === '') return null

  const candidate = fragments[anchor.fragmentIndex]
  const inCandidate = candidate ? locateRange(candidate.text, target) : null
  if (candidate && inCandidate) {
    return { fragmentIndex: anchor.fragmentIndex, offset: inCandidate.start }
  }

  for (const fragment of fragments) {
    const range = locateRange(fragment.text, target)
    if (range) return { fragmentIndex: fragment.index, offset: range.start }
  }

  return null
}
