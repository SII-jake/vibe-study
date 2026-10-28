import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { resolveAnchor } from '../domain/anchor'
import { splitFragments, type Fragment } from '../domain/fragment'
import {
  breadcrumb,
  childrenByFragment,
  descendantCount,
  latestAnswer,
  nodeLabel,
  type LearnNode,
  type Message,
} from '../domain/tree'
import type { AskInput, LearnData } from '../app/store'
import { AskCard } from './AskCard'
import { AskSheet } from './AskSheet'
import { FragmentView } from './FragmentView'
import type { SelectionReading } from './selection'
import { useSelectionAnchor } from './use-selection-anchor'
import {
  readReadingPosition,
  rememberFocus,
  rememberReadingPosition,
  takeFocus,
} from './view-memory'

export interface NodePageProps {
  data: LearnData
  nodeId: string
  onNavigate(nodeId: string): void
  onOpenTree(nodeId: string): void
  /** 打开左侧会话抽屉；桌面由 App 层直接省略此 prop，按钮也随之不出现 */
  onOpenMenu?: () => void
  /** 桌面端：把选中文字交给右栏提问，替代底部弹窗 */
  onRequestAsk?(reading: SelectionReading): void
  /** 桌面端：点分支卡片时在右栏展开子对话，而不是替换中栏 */
  onOpenBranch?(nodeId: string): void
  /**
   * 右栏内嵌形态：去掉整页头与底部追问条，只留正文。
   * 右栏自己有标题栏，重复渲染会挤掉阅读空间。
   */
  compact?: boolean
}

interface PendingAsk {
  fragmentIndex: number
  text: string
  messageId?: string
}

interface FocusState {
  fragmentIndex: number
  text: string
  messageId?: string
}

/** 同节点直接回复的形态：底部输入框接着问；选中文字提问仍会开新分支。 */
export function NodePage({
  data,
  nodeId,
  onNavigate,
  onOpenTree,
  onOpenMenu,
  onRequestAsk,
  onOpenBranch,
  compact = false,
}: NodePageProps) {
  const bodyRef = useRef<HTMLDivElement>(null)
  const [pending, setPending] = useState<PendingAsk | null>(null)
  const [focus, setFocus] = useState<FocusState | null>(null)
  const [followUpDraft, setFollowUpDraft] = useState('')
  const { picked, clear } = useSelectionAnchor(bodyRef)

  const node = data.nodes.find((item) => item.id === nodeId)
  const path = useMemo(() => breadcrumb(data.nodes, nodeId), [data.nodes, nodeId])
  const answer = node ? latestAnswer(node) : null

  /** 完整的对话轮次：user/assistant 消息按时间顺排；回答按片段切分供锚点与选区。 */
  const thread = useMemo<Array<{ message: Message; fragments: Fragment[] }>>(
    () =>
      (node?.messages ?? []).map((message) => ({
        message,
        fragments: message.role === 'assistant' ? splitFragments(message.content) : [],
      })),
    [node],
  )

  /** 每条回答各自携带的子分支，挂在它自己的片段下方；不同轮的回答互不串位。 */
  const branchesByMessage = useMemo<Map<string, Map<number, LearnNode[]>>>(() => {
    const perMessage = new Map<string, Map<number, LearnNode[]>>()
    if (!node) return perMessage
    for (const { message } of thread) {
      if (message.role !== 'assistant') continue
      perMessage.set(message.id, childrenByFragment(data.nodes, node.id, message.id))
    }
    return perMessage
  }, [data.nodes, node, thread])

  /** 返回时高亮的锚点原文，按其记录的消息定位到那一轮回答。 */
  const highlightByMessage = useMemo<Map<string, string | null>>(() => {
    const perMessage = new Map<string, string | null>()
    if (!focus) return perMessage
    for (const { message, fragments } of thread) {
      if (message.role !== 'assistant') continue
      if (focus.messageId && message.id !== focus.messageId) continue
      const resolved = resolveAnchor(fragments, focus)
      perMessage.set(message.id, resolved ? fragments[resolved.fragmentIndex]?.text.slice(resolved.offset) ?? focus.text : focus.text)
    }
    if (perMessage.size === 0 && focus.messageId === undefined) {
      // 锚点没有记录消息 id 时退回最新一条回答
      const lastAssistant = [...thread].reverse().find(({ message }) => message.role === 'assistant')
      if (lastAssistant) {
        const resolved = resolveAnchor(lastAssistant.fragments, focus)
        perMessage.set(lastAssistant.message.id, resolved ? lastAssistant.fragments[resolved.fragmentIndex]?.text.slice(resolved.offset) ?? focus.text : focus.text)
      }
    }
    return perMessage
  }, [focus, thread])

  useEffect(() => {
    const remembered = takeFocus(nodeId)
    if (remembered) {
      setFocus(remembered)
      return
    }
    const scrollTop = readReadingPosition(nodeId)
    if (scrollTop !== null && bodyRef.current) bodyRef.current.scrollTop = scrollTop
  }, [nodeId])

  useEffect(() => {
    const element = bodyRef.current
    if (!element) return
    return () => rememberReadingPosition(nodeId, element.scrollTop)
  }, [nodeId])

  const goBack = useCallback(() => {
    if (!node?.parentId) return
    if (node.anchor) rememberFocus(node.parentId, node.anchor)
    onNavigate(node.parentId)
  }, [node, onNavigate])

  /** 选中文字的开分支提问；分支锚定到被选中文字所在的那条回答。 */
  const submitQuestion = (question: string) => {
    const target = pending
    if (!target || !node) return
    setPending(null)
    clear()
    const input: AskInput = {
      parentId: node.id,
      messageId: target.messageId ?? (latestAnswer(node)?.id ?? ''),
      fragmentIndex: target.fragmentIndex,
      text: target.text,
      question,
    }
    const childId = data.askAt(input)
    rememberReadingPosition(node.id, bodyRef.current?.scrollTop ?? 0)
    onNavigate(childId)
  }

  /** 底部直接回复：不开新分支，问题与回答留在当前节点顺排，上下文含全部历史轮次。 */
  const submitFollowUp = () => {
    const trimmed = followUpDraft.trim()
    // 流式进行中禁止再发起追问，否则并发两个生成都写到同一节点
    if (trimmed === '' || !node || data.streamingNodeId !== null) return
    setFollowUpDraft('')
    data.followUp(node.id, trimmed)
    requestAnimationFrame(() => {
      if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight
    })
  }

  if (!node) {
    return (
      <div className="page">
        <p className="empty">这个节点已不存在。</p>
        <button type="button" className="btn-primary" onClick={onOpenMenu}>
          回到学习主题
        </button>
      </div>
    )
  }

  const streaming = data.streamingNodeId === node.id
  // 面包屑用会话标题（模型摘要），正文标题仍显示用户当时问的原话
  const label = nodeLabel(node)

  return (
    <div className={`page page-reader ${compact ? 'page-reader-compact' : ''}`}>
      {!compact && (
        <header className="reader-head">
        {onOpenMenu && (
          <button type="button" className="icon-btn menu-btn" onClick={onOpenMenu} aria-label="会话列表">
            ☰
          </button>
        )}
        {node.parentId && (
          <button type="button" className="icon-btn" onClick={goBack} aria-label="返回上一级">
            ←
          </button>
        )}
        <div className="reader-crumb">
          <button type="button" className="crumb-link" onClick={() => onOpenTree(path[0]?.id ?? node.id)}>
            {path[0] ? nodeLabel(path[0]) : 'vibe study'}
          </button>
          {path.length > 1 && <span className="crumb-current">{label}</span>}
        </div>
        <button
          type="button"
          className="icon-btn"
          onClick={() => onOpenTree(path[0]?.id ?? node.id)}
          aria-label="Tree"
        >
          ⋔
        </button>
        </header>
      )}

      <div className="reader-body" ref={bodyRef}>
        {node.anchor && (
          <div className="anchor-quote">
            <span className="anchor-quote-label">这段原文</span>
            <p>{node.anchor.text}</p>
          </div>
        )}

        <div className="thread">
          {thread.map(({ message, fragments: messageFragments }, turnIndex) => {
            const branches = branchesByMessage.get(message.id) ?? new Map<number, LearnNode[]>()

            if (message.role === 'user') {
              // 第一条提问用标题形态，其后的追问用对话气泡形态
              return turnIndex === 0 ? (
                <h1 className="reader-question" key={message.id}>
                  {message.content}
                </h1>
              ) : (
                <div className="turn-user" key={message.id}>
                  {message.content}
                </div>
              )
            }

            return (
              <div key={message.id} data-message-id={message.id}>
                {messageFragments.map((fragment) => {
                  const children = branches.get(fragment.index) ?? []
                  return (
                    <div className="fragment-block" key={`${message.id}-${fragment.index}`}>
                      <FragmentView
                        fragment={fragment}
                        highlight={highlightByMessage.get(message.id) ?? null}
                        anchors={children.map((child) => child.anchor?.text ?? '').filter((t) => t !== '')}
                      />
                      {children.map((child) => (
                        <AskCard
                          key={child.id}
                          node={child}
                          branchCount={descendantCount(data.nodes, child.id)}
                          onOpen={onOpenBranch ?? onNavigate}
                        />
                      ))}
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>

        {streaming && (
          <div className="streaming">
            {data.streamingStatus && (
              <p className="streaming-status">🔧 {data.streamingStatus}</p>
            )}
            <p className="streaming-text">{data.streamingText || '正在生成回答…'}</p>
            <button type="button" className="btn-ghost" onClick={data.stopStreaming}>
              停止
            </button>
          </div>
        )}

        {!answer && !streaming && (
          <div className="empty-block">
            <p>这个节点还没有回答。</p>
            <button type="button" className="btn-primary" onClick={() => data.regenerate(node.id)}>
              生成回答
            </button>
          </div>
        )}

        {answer && !streaming && (
          <div className="reader-foot">
            <p className="hint">后面可以直接追问，也可以选中一段文字就那段开新分支。</p>
            <button type="button" className="btn-ghost" onClick={() => data.regenerate(node.id)}>
              重新生成最新回答
            </button>
          </div>
        )}
      </div>

      {/* 右栏也要能继续追问，所以 compact 同样保留底部输入条 */}
      {answer && (
        <div className="follow-bar">
          <textarea
            className="follow-input"
            rows={2}
            placeholder="接着这个回答问…"
            value={followUpDraft}
            disabled={streaming}
            onChange={(event) => setFollowUpDraft(event.target.value)}
          />
          <button
            type="button"
            className="btn-primary follow-send"
            disabled={followUpDraft.trim() === '' || streaming}
            onClick={submitFollowUp}
          >
            问
          </button>
        </div>
      )}

      {picked && (
        <button
          type="button"
          className="ask-fab"
          style={{ left: picked.centerX, top: Math.max(picked.top - 44, 12) }}
          onClick={() => {
            if (onRequestAsk) {
              // 桌面端：右栏就地提问，正文保持可见
              onRequestAsk(picked.reading)
              clear()
              return
            }
            setPending(picked.reading)
          }}
        >
          就这段提问
        </button>
      )}

      {/* 手机端没有右栏，退回底部弹窗；桌面端提问框在右栏 */}
      {pending && !onRequestAsk && (
        <AskSheet
          anchorText={pending.text}
          onSubmit={submitQuestion}
          onCancel={() => setPending(null)}
        />
      )}
    </div>
  )
}
