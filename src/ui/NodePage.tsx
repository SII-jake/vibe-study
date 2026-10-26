import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { resolveAnchor } from '../domain/anchor'
import { splitFragments } from '../domain/fragment'
import {
  breadcrumb,
  childrenByFragment,
  descendantCount,
  latestAnswer,
  type LearnNode,
} from '../domain/tree'
import type { AskInput, LearnData } from '../app/store'
import { AskCard } from './AskCard'
import { AskSheet } from './AskSheet'
import { FragmentView } from './FragmentView'
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
  onOpenTopics(): void
}

export function NodePage({
  data,
  nodeId,
  onNavigate,
  onOpenTree,
  onOpenTopics,
}: NodePageProps) {
  const bodyRef = useRef<HTMLDivElement>(null)
  const [pending, setPending] = useState<{ fragmentIndex: number; text: string } | null>(null)
  const [focus, setFocus] = useState<{ fragmentIndex: number; text: string } | null>(null)
  const { picked, clear } = useSelectionAnchor(bodyRef)

  const node = data.nodes.find((item) => item.id === nodeId)
  const path = useMemo(() => breadcrumb(data.nodes, nodeId), [data.nodes, nodeId])
  const answer = node ? latestAnswer(node) : null
  const fragments = useMemo(() => (answer ? splitFragments(answer.content) : []), [answer])

  const branches = useMemo<Map<number, LearnNode[]>>(
    () => (node ? childrenByFragment(data.nodes, node.id) : new Map()),
    [data.nodes, node],
  )

  /** 锚点原文按当前回答重新定位，回答改写后仍尽量落回原处。 */
  const highlightText = useMemo(() => {
    if (!focus) return null
    const resolved = resolveAnchor(fragments, focus)
    return resolved ? (fragments[resolved.fragmentIndex]?.text.slice(resolved.offset) ?? null) : focus.text
  }, [focus, fragments])

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
    if (!node?.parentId) {
      onOpenTopics()
      return
    }
    if (node.anchor) rememberFocus(node.parentId, node.anchor)
    onNavigate(node.parentId)
  }, [node, onNavigate, onOpenTopics])

  const submitQuestion = (question: string) => {
    if (!pending || !node || !answer) return
    const input: AskInput = {
      parentId: node.id,
      messageId: answer.id,
      fragmentIndex: pending.fragmentIndex,
      text: pending.text,
      question,
    }
    setPending(null)
    clear()
    const childId = data.askAt(input)
    rememberReadingPosition(node.id, bodyRef.current?.scrollTop ?? 0)
    onNavigate(childId)
  }

  if (!node) {
    return (
      <div className="page">
        <p className="empty">这个节点已不存在。</p>
        <button type="button" className="btn-primary" onClick={onOpenTopics}>
          回到学习主题
        </button>
      </div>
    )
  }

  const streaming = data.streamingNodeId === node.id
  const question = node.messages[0]?.content ?? ''

  return (
    <div className="page page-reader">
      <header className="reader-head">
        <button type="button" className="icon-btn" onClick={goBack} aria-label="返回">
          ←
        </button>
        <div className="reader-crumb">
          <button type="button" className="crumb-link" onClick={onOpenTopics}>
            {path[0]?.messages[0]?.content ?? '学习树'}
          </button>
          {path.length > 1 && <span className="crumb-current">{question}</span>}
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

      <div className="reader-body" ref={bodyRef}>
        {node.anchor && (
          <div className="anchor-quote">
            <span className="anchor-quote-label">这段原文</span>
            <p>{node.anchor.text}</p>
          </div>
        )}

        <h1 className="reader-question">{question}</h1>

        {streaming && (
          <div className="streaming">
            <p className="streaming-text">{data.streamingText || '正在生成回答…'}</p>
            <button type="button" className="btn-ghost" onClick={data.stopStreaming}>
              停止
            </button>
          </div>
        )}

        {!streaming && !answer && (
          <div className="empty-block">
            <p>这个节点还没有回答。</p>
            <button type="button" className="btn-primary" onClick={() => data.regenerate(node.id)}>
              生成回答
            </button>
          </div>
        )}

        {!streaming &&
          fragments.map((fragment) => {
            const children = branches.get(fragment.index) ?? []
            return (
              <div className="fragment-block" key={fragment.index}>
                <FragmentView
                  fragment={fragment}
                  highlight={highlightText}
                />
                {children.map((child) => (
                  <AskCard
                    key={child.id}
                    node={child}
                    branchCount={descendantCount(data.nodes, child.id)}
                    onOpen={onNavigate}
                  />
                ))}
              </div>
            )
          })}

        {answer && !streaming && (
          <div className="reader-foot">
            <p className="hint">选中一段文字，可以就那一段继续提问。</p>
            <button type="button" className="btn-ghost" onClick={() => data.regenerate(node.id)}>
              重新生成回答
            </button>
          </div>
        )}
      </div>

      {picked && (
        <button
          type="button"
          className="ask-fab"
          style={{ left: picked.centerX, top: Math.max(picked.top - 44, 12) }}
          onClick={() => setPending(picked.reading)}
        >
          就这段提问
        </button>
      )}

      {pending && (
        <AskSheet
          anchorText={pending.text}
          onSubmit={submitQuestion}
          onCancel={() => setPending(null)}
        />
      )}
    </div>
  )
}
