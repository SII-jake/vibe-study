import { createElement, memo, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react'
import clsx from 'clsx'
import type {
  BlockContent,
  DefinitionContent,
  List as ListNode,
  PhrasingContent,
  Root,
  Table as TableNode,
} from 'mdast'
import type { FragmentAskEntry } from '../messages/fragmentAsks.js'
import { CitationLink } from '../search/CitationLink.js'
import { CodeBlock } from './CodeBlock.js'
import { ImageAsLink, Link } from './Link.js'
import { InlineMath, MathBlock } from './MathFormula.js'

const Html = memo(function Html({ value }: { value: string }) {
  if (/^<br\s*\/?>$/i.test(value)) {
    return <br />
  }
  return <span className="ds-markdown-html">{value}</span>
})

const List = memo(function List({ node, loading }: { node: ListNode; loading: boolean }) {
  const ListTag = node.ordered ? 'ol' : 'ul'
  return (
    <ListTag start={node.ordered ? node.start || undefined : undefined}>
      {node.children.map((child, index) => {
        // GFM: task item 的 checked 为 boolean；普通 listItem 为 null
        const checked = child.checked
        const isTaskItem = typeof checked === 'boolean'
        return (
          <li key={index} className={isTaskItem ? 'ds-markdown-task-list-item' : undefined}>
            {isTaskItem ? (
              // □ U+25A1 / ☑ U+2611
              <span className="ds-markdown-task-checkbox">{checked ? '☑  ' : '□  '}</span>
            ) : null}
            <MarkdownBlockContentOrDefinitionContent nodes={child.children} loading={loading} />
          </li>
        )
      })}
    </ListTag>
  )
})

const Table = memo(function Table({ node }: { node: TableNode }) {
  const columnCount = node.children[0]?.children.length
  return (
    <div className="markdown-table-wrapper">
      <table>
        {node.children[0] ? (
          <thead>
            <tr>
              {node.children[0].children.map((cell, cellIndex) => {
                return (
                  <th key={cellIndex}>
                    <MarkdownPhrasingContent nodes={cell.children} />
                  </th>
                )
              })}
            </tr>
          </thead>
        ) : null}
        {node.children[1] ? (
          <tbody>
            {node.children.slice(1).map((row, rowIndex) => {
              const curColumnCount = row.children.length || 0
              return (
                <tr key={rowIndex}>
                  {row.children.map((cell, cellIndex) => {
                    return (
                      <td key={cellIndex}>
                        <MarkdownPhrasingContent nodes={cell.children} />
                      </td>
                    )
                  })}
                  {/* 补齐到列数 */}
                  {Array.from({ length: columnCount - curColumnCount }).map((_, idx) => (
                    <td key={`ptd_${idx}`} />
                  ))}
                </tr>
              )
            })}
          </tbody>
        ) : null}
      </table>
    </div>
  )
})

/** phrasing 节点的纯文本量（跨节点匹配用的游标推进单位） */
const phrasingTextOf = (node: PhrasingContent): string => {
  if (node.type === 'text' || node.type === 'inlineCode') return node.value
  if ('children' in node && Array.isArray(node.children)) {
    return (node.children as PhrasingContent[]).map(phrasingTextOf).join('')
  }
  return ''
}

type AnchorSpec = { text: string; isReturn?: boolean }

const MarkdownPhrasingContent = memo(function MarkdownPhrasingContent({
  nodes,
  anchors,
}: {
  nodes: PhrasingContent[]
  /** 追问锚点（真机反馈①②）：命中的文本区间打进 data-ask-referenced 内联
   *  span——下划线只包选中的那撮文本；区间按所有节点纯文本拼接定位，
   *  跨过 strong/em/inlineCode 边界的锚点也能命中（第三轮：曾只认纯 text
   *  节点导致跨格式追问整条没有下划线）。多个锚点各自独立标记。
   *  isReturn 的锚点（「返回到这里」）命中的片段再打 data-ask-return。 */
  anchors?: AnchorSpec[]
}) {
  if (anchors && anchors.length > 0) {
    const joined = nodes.map(phrasingTextOf).join('')
    const intervals = anchors
      .map((a) => {
        const start = joined.indexOf(a.text)
        return start < 0
          ? null
          : { start, end: start + a.text.length, isReturn: !!a.isReturn }
      })
      .filter((x): x is { start: number; end: number; isReturn: boolean } => x !== null)
    if (intervals.length > 0) {
      type Part = { node: PhrasingContent; marked: boolean; isReturn: boolean }
      const parts: Part[] = []
      let cursor = 0
      for (const node of nodes) {
        const width = phrasingTextOf(node).length
        const from = cursor
        const to = cursor + width
        cursor = to
        const active = intervals.filter((iv) => to > iv.start && from < iv.end)
        if (width === 0 || active.length === 0) {
          parts.push({ node, marked: false, isReturn: false })
          continue
        }
        if (node.type === 'text') {
          const cuts = new Set<number>([0, node.value.length])
          for (const iv of active) {
            cuts.add(Math.max(0, iv.start - from))
            cuts.add(Math.min(node.value.length, iv.end - from))
          }
          const sorted = [...cuts].sort((a, b) => a - b)
          for (let i = 0; i < sorted.length - 1; i++) {
            const segStart = sorted[i]!
            const segEnd = sorted[i + 1]!
            if (segStart === segEnd) continue
            const absStart = from + segStart
            const absEnd = from + segEnd
            const segHits = intervals.filter((iv) => absEnd > iv.start && absStart < iv.end)
            parts.push({
              node: { ...node, value: node.value.slice(segStart, segEnd) },
              marked: segHits.length > 0,
              isReturn: segHits.some((iv) => iv.isReturn),
            })
          }
          continue
        }
        // 非 text 节点整体进命中区（跨格式锚点包最小节点集，绝不整条丢标记）
        parts.push({ node, marked: true, isReturn: active.some((iv) => iv.isReturn) })
      }
      return (
        <>
          {parts.map((part, index) =>
            part.marked ? (
              <span
                key={index}
                data-ask-referenced
                {...(part.isReturn ? { 'data-ask-return': true } : {})}
              >
                <MarkdownPhrasingContentItem node={part.node} />
              </span>
            ) : (
              <MarkdownPhrasingContentItem key={index} node={part.node} />
            ),
          )}
        </>
      )
    }
    // 匹配不到的锚点（正文与锚点漂移）：退为原样渲染，由块级兜底挂卡
  }
  return (
    <>
      {nodes.map((node, index) => {
        return <MarkdownPhrasingContentItem key={index} node={node} />
      })}
    </>
  )
})

const MarkdownPhrasingContentItem = memo(function MarkdownPhrasingContentItem({
  node,
}: {
  node: PhrasingContent
}) {
  switch (node.type) {
    case 'inlineMath':
      return <InlineMath value={node.value} />
    case 'break':
      return <br />
    case 'emphasis':
      return (
        <em>
          <MarkdownPhrasingContent nodes={node.children} />
        </em>
      )
    case 'image':
      return <ImageAsLink node={node} />
    case 'html':
      return <Html value={node.value} />
    case 'inlineCode':
      return <code>{node.value}</code>
    case 'link':
      return (
        <Link node={node}>
          <MarkdownPhrasingContent nodes={node.children} />
        </Link>
      )
    case 'strong':
      return (
        <strong>
          <MarkdownPhrasingContent nodes={node.children} />
        </strong>
      )
    case 'text':
      return <TextContent>{node.value}</TextContent>
    case 'citation':
      return <CitationLink source={node.source} />
    default:
      // 删除线、脚注、引用式链接已在解析时换成文本
      return null
  }
})

// 按 \n 拆行插 <br>：源文每个换行（含软换行）都渲染为视觉换行
const TextContent = memo(function TextContent({ children }: { children: string }) {
  const result: ReactNode[] = []
  children.split(/\r?\n/).forEach((line, index) => {
    result.push(<span key={index + 's'}>{line}</span>, <br key={index + 'br'} />)
  })
  result.pop()
  return result
})


/** 顶层块的纯文本（用于 anchorText 精确匹配）——与 phrasingTextOf 同一口径
 *  （跨 strong/em/inlineCode 拼接），只收 paragraph/heading，其余块返回 ''。 */
const blockTextOf = (node: { type: string; children?: unknown[] }): string => {
  if (node.type !== 'paragraph' && node.type !== 'heading') return ''
  return ((node.children ?? []) as PhrasingContent[]).map(phrasingTextOf).join('')
}

/** 追问引子卡元素——命中块挂块下、脱靶沉正文末尾同一形态（第二轮真机反馈②）。 */
const askCardButton = (
  ask: FragmentAskEntry,
  onAskOpen?: (rootId: string) => void,
) => (
  <button
    key={ask.rootId}
    type="button"
    className="ds-ask-card"
    data-ask-card
    data-ask-root={ask.rootId}
    onClick={() => onAskOpen?.(ask.rootId)}
  >
    <span className="ds-ask-card-mark">💬</span>
    <span className="ds-ask-card-question">{ask.question}</span>
    <span className="ds-ask-card-meta">
      {ask.branchCount > 1 ? `${ask.branchCount} 条追问 ` : ''}›
    </span>
  </button>
)

const MarkdownBlockContentOrDefinitionContent = memo(
  function MarkdownBlockContentOrDefinitionContent({
    nodes,
    loading,
    topLevel = false,
    fragmentAsk,
    onAskOpen,
    returnAnchorText,
  }: {
    nodes: Array<BlockContent | DefinitionContent>
    loading: boolean
    /**
     * 片段级锚点（decisions/2026-11-19）：仅根渲染层打 data-fragment-index——
     * blockquote/list 递归渲染子块时不能编号，否则一条回答会产生多个
     * 同一 anchorMessageId 下的同名 fragmentIndex，片段唯一定位被破坏；
     * li 里塞 div 也是错误嵌套。
     */
    topLevel?: boolean
    /** 第五步（decisions/2026-11-19 §二.5）：按片段索引注入追问引子——
     *  被追片段宿主打 data-ask-referenced 下划线，片段下挂引子卡。
     *  仅根渲染层消费（与片段宿主同层）；嵌套层不挂，避免重复引子。 */
    fragmentAsk?: FragmentAskEntry[]
    /** 点引子卡（§二.5 与点卡同路径：子对话进右栏/下潜），透传到 AssistantMessage */
    onAskOpen?: (rootId: string) => void
    /** 「返回到这里」的锚点原文（§二.5）：命中的锚点区间加打 data-ask-return——
     *  与下划线同位同粒度，不再用块级背景（第三轮真机反馈：背景块范围过大）。 */
    returnAnchorText?: string | null
  }) {
    // 第二轮真机反馈①②：挂载点按 anchorText 在块文本内精确匹配——
    // 存的 fragmentIndex 仅作存储兼容（正文块序漂移后按索引挂必错位），
    // 不再作为定位依据；匹配失败的 ask 兜底沉正文末尾，不静默丢失。
    let pendingAsks = topLevel ? [...(fragmentAsk ?? [])] : []
    const blocks: ReactNode[] = []
    nodes.forEach((node, index) => {
      let anchors: AnchorSpec[] | undefined
      let blockAsks: FragmentAskEntry[] = []
      if (topLevel) {
        const text = blockTextOf(node)
        if (text !== '') {
          const hits = pendingAsks.filter((ask) => text.includes(ask.anchorText))
          if (hits.length > 0) {
            pendingAsks = pendingAsks.filter((ask) => !hits.includes(ask))
            blockAsks = hits
            anchors = [...new Set(hits.map((ask) => ask.anchorText))].map((text2) => ({
              text: text2,
              isReturn: text2 === returnAnchorText,
            }))
          }
        }
      }
      const asks = blockAsks
      const output = (() => {
      switch (node.type) {
        case 'math':
          return <MathBlock key={index} value={node.value} />
        case 'thematicBreak':
          return <hr key={index} />
        case 'blockquote':
          return (
            <blockquote key={index}>
              <MarkdownBlockContentOrDefinitionContent nodes={node.children} loading={loading} />
            </blockquote>
          )
        case 'html':
          return <Html key={index} value={node.value} />
        case 'heading':
          return node.children.length === 0
            ? null
            : createElement(
                `h${node.depth}`,
                { key: index },
                <MarkdownPhrasingContent nodes={node.children} anchors={anchors} />
              )
        case 'paragraph':
          return (
            <p key={index} className="ds-markdown-paragraph">
              <MarkdownPhrasingContent nodes={node.children} anchors={anchors} />
            </p>
          )
        case 'code':
          return (
            <CodeBlock
              key={index}
              code={node.value}
              infostring={node.lang || 'text'}
              loading={loading}
            />
          )
        case 'table':
          return <Table node={node} key={index} />
        case 'list':
          return <List key={index} node={node} loading={loading} />
        default:
          // 脚注与定义已在解析时换成段落
          return null
      }
      })()
      if (output === null) return
      if (topLevel) {
        blocks.push(
          <div
            key={index}
            data-fragment-index={index}

          >
            {output}
            {asks.map((ask) => askCardButton(ask, onAskOpen))}
          </div>,
        )
      } else {
        blocks.push(output)
      }
    })
    // 脱靶卡兜底（fragmentIndex 为 null 的旧记录锚点已是整段引文、匹配不到
    // 任何当前块文本）：沉在正文末尾陈列，入口不丢也不钉错块。
    if (topLevel && pendingAsks.length > 0) {
      blocks.push(
        <div key="ds-ask-fallback" data-ask-fallback>
          {pendingAsks.map((ask) => askCardButton(ask, onAskOpen))}
        </div>,
      )
    }
    return blocks
  }
)

export const MarkdownAstRenderer = memo(function MarkdownAstRenderer({
  ast,
  onUpdate,
  className,
  loading = false,
  fragmentAsk,
  onAskOpen,
  returnAnchorText,
}: {
  ast: Root
  className?: string
  loading?: boolean
  fragmentAsk?: FragmentAskEntry[]
  onAskOpen?: (rootId: string) => void
  returnAnchorText?: string | null
  /**
   * layoutEffect 之后触发 -> 进行页面滚动
   */
  onUpdate: () => void
}) {
  const onUpdateRef = useRef<() => void>(() => 0)
  onUpdateRef.current = onUpdate
  useLayoutEffect(() => {
    onUpdateRef.current()
  }, [ast.children])

  return useMemo(
    () => (
      <div className={clsx('ds-markdown', className)}>
        {/* 解析器在根节点下产出块级内容。 */}
        <MarkdownBlockContentOrDefinitionContent
          nodes={ast.children as Array<BlockContent | DefinitionContent>}
          loading={loading}
          topLevel
          fragmentAsk={fragmentAsk}
          onAskOpen={onAskOpen}
          returnAnchorText={returnAnchorText}
        />
      </div>
    ),
    [className, ast.children, loading, fragmentAsk, onAskOpen, returnAnchorText]
  )
})
