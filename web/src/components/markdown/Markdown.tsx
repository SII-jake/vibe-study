import { memo, useMemo } from 'react'
import type { FragmentAskEntry } from '../messages/fragmentAsks.js'
import type { Source } from '../../services/chat/view.js'
import { toMdAst } from '../../services/markdown/parse.js'
import { useScrollToBottom } from '../messages/scrollContext.js'
import { MarkdownAstRenderer } from './MarkdownAstRenderer.js'
import { useThrottleMarkdownRender } from './useThrottleMarkdownRender.js'
import './markdown.css'
import './highlight.css'

/**
 * 渲染链路：节流 → 解析 AST → 渲染。
 * 传入 sources 时把正文里的 [citation:N] 渲染为角标。
 */
export const Markdown = memo(function Markdown({
  content,
  loading,
  cacheKey,
  className,
  disableLink,
  sources,
  fragmentAsk,
  onAskOpen,
  returnAnchorText,
}: {
  content: string
  loading: boolean
  cacheKey: string
  className?: string
  disableLink: boolean
  sources?: Source[]
  /** 第五步（§二.5 + 真机反馈修订）：片段级追问引子与点击接线——为渲染
   *  层的 anchorText 精确匹配做的数组（存的 fragmentIndex 仅兼容不作依据） */
  fragmentAsk?: FragmentAskEntry[]
  onAskOpen?: (rootId: string) => void
  /** 「返回到这里」锚点原文（§二.5）：仅来源锚点消息注入 */
  returnAnchorText?: string | null
}) {
  const scrollToBottom = useScrollToBottom()
  const throttledMarkdown = useThrottleMarkdownRender(content, loading)
  const ast = useMemo(
    () => (throttledMarkdown ? toMdAst(throttledMarkdown, { sources, disableLink }) : null),
    [throttledMarkdown, sources, disableLink]
  )
  return ast ? (
    <MarkdownAstRenderer
      key={cacheKey}
      className={className}
      ast={ast}
      loading={loading}
      onUpdate={scrollToBottom}
      fragmentAsk={fragmentAsk}
      onAskOpen={onAskOpen}
      returnAnchorText={returnAnchorText}
    />
  ) : null
})
