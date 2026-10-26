import { useEffect, useRef } from 'react'
import type { Fragment } from '../domain/fragment'
import { clearHighlights, highlightInFragment } from './dom-highlight'
import { renderFragmentHtml } from './render'

export interface FragmentViewProps {
  fragment: Fragment
  /** 需要高亮的锚点原文；跨片段返回时使用 */
  highlight?: string | null
}

/** 单个片段：HTML 由已净化的 Markdown 渲染结果注入，并带上片段序号供锚点定位。 */
export function FragmentView({ fragment, highlight }: FragmentViewProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const element = ref.current
    if (!element) return
    clearHighlights(element)
    if (!highlight) return
    // 高亮保留在页面上，作为"返回到这里"的标记；只在命中时滚动一次。
    if (highlightInFragment(element, highlight)) {
      element.scrollIntoView({ block: 'center', behavior: 'auto' })
    }
  }, [highlight])

  return (
    <div
      ref={ref}
      className={`fragment fragment-${fragment.kind}`}
      data-fragment-index={fragment.index}
      dangerouslySetInnerHTML={{ __html: renderFragmentHtml(fragment) }}
    />
  )
}
