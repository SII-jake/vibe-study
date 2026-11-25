import {
  createElement,
  memo,
  useLayoutEffect,
  useMemo,
  useRef,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react'
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

const List = memo(function List({
  node,
  loading,
  anchors,
}: {
  node: ListNode
  loading: boolean
  /** 划线锚点透传（真机反馈②整改）：用户常以"选中列表项一部分"发起追问——
   *  锚点继续向内层 phrasing 传递，li 内命中即打 data-ask-referenced */
  anchors?: AnchorSpec[]
}) {
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
            <MarkdownBlockContentOrDefinitionContent
              nodes={child.children}
              loading={loading}
              nestedAnchors={anchors}
            />
          </li>
        )
      })}
    </ListTag>
  )
})

const Table = memo(function Table({
  node,
  anchors,
}: {
  node: TableNode
  /** 划线锚点（真机反馈 2026-11-25）：表格单元格内选中的片段常驻下划线 */
  anchors?: AnchorSpec[]
}) {
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
                    <MarkdownPhrasingContent nodes={cell.children} anchors={anchors} />
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
                        <MarkdownPhrasingContent nodes={cell.children} anchors={anchors} />
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

/** 划线锚点：text 定位、isReturn 决定「返回到这里」高亮、
 *  rootId 是该锚点对应追问分支的根用户消息 id（点下划线进追问用）。
 *  scope 是锚点所属叶子的完整文本——同一个容器块（列表/表格/引用块）里有
 *  多个叶子时，锚点只在该叶子内生效，否则「第二项文字」里的「文字」会把
 *  第一项也划上（真机反馈 2026-11-25 修）。 */
type AnchorSpec = {
  text: string
  isReturn?: boolean
  rootId?: string
  scope?: string
}

const MarkdownPhrasingContent = memo(function MarkdownPhrasingContent({
  nodes,
  anchors,
}: {
  nodes: PhrasingContent[]
  /** 追问锚点（真机反馈①②）：命中的文本区间打进 data-ask-referenced 内联
   *  span——下划线只包选中的那撮文本；区间按所有节点纯文本拼接定位，
   *  跨过 strong/em/inlineCode 边界的锚点也能命中（第三轮：曾只认纯 text
   *  节点导致跨格式追问整条没有下划线）。多个锚点各自独立标记。
   *  isReturn 的锚点（「返回到这里」）命中的片段再打 data-ask-return；
   *  rootId 打到 data-ask-root，点下划线即进追问（与点引子卡同一路径）。 */
  anchors?: AnchorSpec[]
}) {
  if (anchors && anchors.length > 0) {
    const joined = nodes.map(phrasingTextOf).join('')
    const intervals = anchors
      // scope 有值时只认自己那片叶子：容器块内多个叶子共用一份锚点数组，
      // 不按叶子收窄会让子串命中串到隔壁项去。
      .filter((a) => a.scope === undefined || a.scope === joined)
      .map((a) => {
        const start = joined.indexOf(a.text)
        return start < 0
          ? null
          : { start, end: start + a.text.length, isReturn: !!a.isReturn, rootId: a.rootId }
      })
      .filter(
        (
          x,
        ): x is { start: number; end: number; isReturn: boolean; rootId: string | undefined } =>
          x !== null,
      )
    if (intervals.length > 0) {
      type Part = { node: PhrasingContent; marked: boolean; isReturn: boolean; rootId?: string }
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
              rootId: segHits.find((iv) => iv.rootId)?.rootId,
            })
          }
          continue
        }
        // 非 text 节点整体进命中区（跨格式锚点包最小节点集，绝不整条丢标记）
        parts.push({
          node,
          marked: true,
          isReturn: active.some((iv) => iv.isReturn),
          rootId: active.find((iv) => iv.rootId)?.rootId,
        })
      }
      return (
        <>
          {parts.map((part, index) =>
            part.marked ? (
              <span
                key={index}
                data-ask-referenced
                {...(part.isReturn ? { 'data-ask-return': true } : {})}
                {...(part.rootId ? { 'data-ask-root': part.rootId } : {})}
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


type LooseNode = { type: string; children?: unknown[]; value?: unknown }

/** 片段内「可被选中且能画线」的最小文本单元（叶子）：段落/标题一段、代码块
 *  整块、表格一格、列表项一段（嵌套再递归）。锚点定位必须按叶子判——
 *  容器块只做聚合，若按列表项之间拼出来的合成文本整段匹配，会「命中却画不出
 *  下划线」（真机反馈「有时候选中的文字没有下划线」的成因之一）。 */
const leafTextsOf = (node: LooseNode): string[] => {
  switch (node.type) {
    case 'paragraph':
    case 'heading':
      return [((node.children ?? []) as PhrasingContent[]).map(phrasingTextOf).join('')]
    case 'code':
      return [typeof node.value === 'string' ? node.value : '']
    case 'table':
      return ((node.children ?? []) as Array<{ children?: LooseNode[] }>).flatMap((row) =>
        (row.children ?? []).map((cell) =>
          ((cell.children ?? []) as PhrasingContent[]).map(phrasingTextOf).join(''),
        ),
      )
    case 'list':
      return ((node.children ?? []) as LooseNode[]).flatMap((item) =>
        ((item.children ?? []) as LooseNode[]).flatMap(leafTextsOf),
      )
    case 'blockquote':
      return ((node.children ?? []) as LooseNode[]).flatMap(leafTextsOf)
    default:
      return []
  }
}

interface PlannedAnchors {
  /** 每个顶层块要传下去的划线锚点（嵌套层沿 nestedAnchors 继续下传） */
  anchorsByBlock: AnchorSpec[][]
  /** 每个顶层块片段下要挂的引子卡（跨块选区挂在首个命中块） */
  asksByBlock: FragmentAskEntry[][]
  /** 两个层级都定位不到：沉正文末尾兜底，入口不丢、也不钉错块 */
  pending: FragmentAskEntry[]
}

/**
 * 锚点铺排（真机反馈 2026-11-25）。两步：
 * 1. 同一叶子内整段包含——既有口径，覆盖段落/标题/列表项/表格格/代码块；
 * 2. 跨块/跨叶子选区——选区文字按换行拆段，逐段找宿主块。
 *    要求全部段落都落地、且块序单调不回头，否则视为重复文本的巧合命中，
 *    交给兜底卡：宁可不错钉，也不把下划线画到不相干的位置。
 */
function planAskAnchors(
  nodes: LooseNode[],
  asks: FragmentAskEntry[],
  returnAnchorText: string | null | undefined,
): PlannedAnchors {
  const leaves = nodes.map(leafTextsOf)
  const anchorsByBlock: AnchorSpec[][] = nodes.map(() => [])
  const asksByBlock: FragmentAskEntry[][] = nodes.map(() => [])
  const pending: FragmentAskEntry[] = []

  const addAnchor = (
    block: number,
    text: string,
    rootId: string | undefined,
    isReturn: boolean,
    scope: string,
  ) => {
    const bucket = anchorsByBlock[block]!
    const existing = bucket.find((anchor) => anchor.text === text && anchor.scope === scope)
    if (existing) {
      // 同一段文本被追问多次：下划线只画一次，返回到这里优先级更高
      if (isReturn) existing.isReturn = true
      return
    }
    bucket.push({ text, isReturn, rootId, scope })
  }

  /** 定位命中的块与叶子文本（叶子文本即 scope：锚点只在它里面生效）。 */
  const locate = (
    predicate: (text: string) => boolean,
  ): { block: number; scope: string } | null => {
    for (let block = 0; block < leaves.length; block++) {
      const hit = leaves[block]!.find((text) => text !== '' && predicate(text))
      if (hit !== undefined) return { block, scope: hit }
    }
    return null
  }

  for (const ask of asks) {
    const anchor = ask.anchorText
    const isReturn = anchor === returnAnchorText
    if (anchor !== '') {
      // 1) 同一叶子内整段命中
      const direct = locate((text) => text.includes(anchor))
      if (direct) {
        addAnchor(direct.block, anchor, ask.rootId, isReturn, direct.scope)
        asksByBlock[direct.block]!.push(ask)
        continue
      }
      // 2) 跨叶子/跨块：按换行拆段，逐段找宿主块
      const segments = anchor
        .split(/\r?\n+/)
        .map((segment) => segment.trim())
        .filter((segment) => segment !== '')
      if (segments.length >= 2) {
        const placed: Array<{ block: number; scope: string; text: string }> = []
        let complete = true
        for (const segment of segments) {
          const found = locate((text) => text.includes(segment))
          if (!found) {
            complete = false
            break
          }
          placed.push({ block: found.block, scope: found.scope, text: segment })
        }
        if (complete) {
          for (let i = 1; i < placed.length; i++) {
            if (placed[i]!.block < placed[i - 1]!.block) {
              complete = false
              break
            }
          }
        }
        if (complete) {
          for (const part of placed) {
            addAnchor(part.block, part.text, ask.rootId, isReturn, part.scope)
          }
          asksByBlock[placed[0]!.block]!.push(ask)
          continue
        }
      }
    }
    pending.push(ask)
  }
  return { anchorsByBlock, asksByBlock, pending }
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
    nestedAnchors,
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
    /** 嵌套层划线锚点（真机反馈②）：list/blockquote 递归渲染时带上，内层
     *  phrasing 继续打 data-ask-referenced——锚点落在列表项内不再整条丢线。 */
    nestedAnchors?: AnchorSpec[]
  }) {
    // 第二轮真机反馈①②：挂载点按 anchorText 在块文本内精确匹配——
    // 存的 fragmentIndex 仅作存储兼容（正文块序漂移后按索引挂必错位），
    // 不再作为定位依据；匹配失败的 ask 兜底沉正文末尾，不静默丢失。
    // 真机反馈 2026-11-25：匹配单位下沉到叶子（段落/标题/代码块/表格格/列表项），
    // 并支持跨块选区按换行拆段——引用块、表格、代码块与跨段落跨列表项的选中
    // 不再只落兜底卡而没有下划线。铺排只做一次（O(块数×叶子数)），不在循环里累积。
    const plan = topLevel
      ? planAskAnchors(nodes as LooseNode[], fragmentAsk ?? [], returnAnchorText)
      : null
    const blocks: ReactNode[] = []
    nodes.forEach((node, index) => {
      const planned = plan ? plan.anchorsByBlock[index] : undefined
      const asks = plan ? plan.asksByBlock[index]! : []
      // 划线的作用判定分两层：顶层块以铺排结果为准；
      // 嵌套层（list li / blockquote 递归渲染）沿 nestedAnchors 继续向下传——
      // 划线本质发生在内层 phrasing，不在列表/lane 容器这层凭空生效。
      const anchors = plan ? (planned && planned.length > 0 ? planned : undefined) : nestedAnchors
      const output = (() => {
      switch (node.type) {
        case 'math':
          return <MathBlock key={index} value={node.value} />
        case 'thematicBreak':
          return <hr key={index} />
        case 'blockquote':
          return (
            <blockquote key={index}>
              {/* 引用块内的锚点沿 nestedAnchors 下传给内层段落——否则引用块里
                  选中的片段只落兜底卡、画不出下划线（真机反馈 2026-11-25） */}
              <MarkdownBlockContentOrDefinitionContent
                nodes={node.children}
                loading={loading}
                nestedAnchors={anchors}
              />
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
              anchors={anchors}
            />
          )
        case 'table':
          return <Table node={node} key={index} anchors={anchors} />
        case 'list':
          return <List key={index} node={node} loading={loading} anchors={anchors} />
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
    if (plan && plan.pending.length > 0) {
      blocks.push(
        <div key="ds-ask-fallback" data-ask-fallback>
          {plan.pending.map((ask) => askCardButton(ask, onAskOpen))}
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

  // 点下划线进追问（真机反馈 2026-11-22）：与点引子卡同一路径（decisions/
  // 2026-11-19 §二.5）。事件委托挂在渲染根——下划线 span 穿透在 blockquote/
  // list/table 等多层递归里，逐层传 onClick 会把 props 面撕开一大片。
  // 链接优先：命中 <a> 时交给链接自己（站内预览/浏览器），不误当追问入口。
  const onAskOpenRef = useRef(onAskOpen)
  onAskOpenRef.current = onAskOpen
  const handleClick = useMemo(
    () => (event: ReactMouseEvent<HTMLDivElement>) => {
      const target = event.target
      if (!(target instanceof Element)) return
      const marked = target.closest('[data-ask-root]')
      if (!marked) return
      // 引子卡自带 onClick（与下划线同一目标），不重复触发
      if (target.closest('[data-ask-card]')) return
      // 下划线内部的链接优先走链接语义
      if (target.closest('a')) return
      const rootId = marked.getAttribute('data-ask-root')
      if (!rootId) return
      onAskOpenRef.current?.(rootId)
    },
    [],
  )

  return useMemo(
    () => (
      <div className={clsx('ds-markdown', className)} onClick={handleClick}>
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
    [className, ast.children, loading, fragmentAsk, onAskOpen, returnAnchorText, handleClick]
  )
})
