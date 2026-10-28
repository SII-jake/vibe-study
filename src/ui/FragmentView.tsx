import { useEffect, useRef } from 'react'
import type { Fragment } from '../domain/fragment'
import {
  clearAnchorMarks,
  clearHighlights,
  highlightAnchorText,
  highlightInFragment,
} from './dom-highlight'
import { renderFragmentHtml } from './render'

export interface FragmentViewProps {
  fragment: Fragment
  /** 需要高亮的锚点原文；跨片段返回时使用 */
  highlight?: string | null
  /** 挂在该片段下的分支锚点原文；这些文字会画上下划线，表示这里挂着子对话 */
  anchors?: string[]
}

/** 单个片段：HTML 由已净化的 Markdown 渲染结果注入，并带上片段序号供锚点定位。 */
export function FragmentView({ fragment, highlight, anchors }: FragmentViewProps) {
  const ref = useRef<HTMLDivElement>(null)
  // anchors 数组每次渲染都是新引用；用内容拼接做依赖，避免无味重建标记
  const anchorsKey = (anchors ?? []).join('')

  useEffect(() => {
    const element = ref.current
    if (!element) return
    clearHighlights(element)
    clearAnchorMarks(element)
    if (highlight && highlightInFragment(element, highlight)) {
      // 高亮保留在页面上，作为"返回到这里"的标记；jsdom 里没有 scrollIntoView，防御缺实现
      if (typeof element.scrollIntoView === 'function') {
        element.scrollIntoView({ block: 'center', behavior: 'auto' })
      }
    }
    // 下划线标记常驻片段上，不作为滚动触发器；命中不了就静默降级
    for (const anchor of anchors ?? []) highlightAnchorText(element, anchor)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- anchors 已折叠进 anchorsKey
  }, [highlight, anchorsKey])

  return (
    <div
      ref={ref}
      className={`fragment fragment-${fragment.kind}`}
      data-fragment-index={fragment.index}
      dangerouslySetInnerHTML={{ __html: renderFragmentHtml(fragment) }}
    />
  )
}
