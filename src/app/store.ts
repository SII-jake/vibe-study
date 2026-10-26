import { useCallback, useEffect, useRef, useState } from 'react'
import { buildChatMessages } from '../domain/chat'
import { addChildNode, type LearnNode, breadcrumb, createRootNode } from '../domain/tree'
import { appendAnswer, clearAnswers, removeSubtree } from '../domain/tree-ops'
import { streamChat } from '../ai/provider'
import { isConfigured, loadConfig } from '../ai/settings'
import { loadNodes, replaceAllNodes } from '../storage/db'
import { createDemoNodes } from './demo'

export interface AskInput {
  parentId: string
  messageId: string
  fragmentIndex: number
  text: string
  question: string
}

export interface LearnData {
  ready: boolean
  nodes: LearnNode[]
  streamingNodeId: string | null
  streamingText: string
  error: string | null
  createTopic(topic: string): string
  askAt(input: AskInput): string
  regenerate(nodeId: string): void
  remove(nodeId: string): void
  seedDemo(): Promise<void>
  clearError(): void
  stopStreaming(): void
}

let saveChain: Promise<void> = Promise.resolve()

/** 串行落盘，避免并发写入互相覆盖。 */
function persist(nodes: LearnNode[]): void {
  saveChain = saveChain.then(() => replaceAllNodes(nodes)).catch(() => undefined)
}

function newNodeId(): string {
  return `n-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function useLearnData(): LearnData {
  const [nodes, setNodes] = useState<LearnNode[]>([])
  const [ready, setReady] = useState(false)
  const [streamingNodeId, setStreamingNodeId] = useState<string | null>(null)
  const [streamingText, setStreamingText] = useState('')
  const [error, setError] = useState<string | null>(null)

  const nodesRef = useRef<LearnNode[]>([])
  const controllerRef = useRef<AbortController | null>(null)

  useEffect(() => {
    nodesRef.current = nodes
  }, [nodes])

  useEffect(() => {
    loadNodes()
      .then((loaded) => {
        setNodes(loaded)
        nodesRef.current = loaded
      })
      .catch(() => setError('读取本地数据失败'))
      .finally(() => setReady(true))
  }, [])

  const apply = useCallback((next: LearnNode[]) => {
    nodesRef.current = next
    setNodes(next)
    persist(next)
  }, [])

  const runStream = useCallback(
    async (nodeId: string, latestNodes: LearnNode[]) => {
      const config = loadConfig()
      if (!isConfigured(config)) {
        setError('还没有配置模型接口，先去设置里填地址、密钥与模型名。')
        return
      }

      const controller = new AbortController()
      controllerRef.current = controller
      setStreamingNodeId(nodeId)
      setStreamingText('')

      let accumulated = ''
      try {
        await streamChat({
          config,
          messages: buildChatMessages(breadcrumb(latestNodes, nodeId)),
          signal: controller.signal,
          onDelta: (delta) => {
            accumulated += delta
            setStreamingText(accumulated)
          },
        })
        if (accumulated.trim() === '') {
          setError('模型没有返回内容，换个模型名或稍后重试。')
          return
        }
        apply(appendAnswer(nodesRef.current, nodeId, accumulated, Date.now()))
      } catch (cause) {
        if (controller.signal.aborted) {
          apply(clearAnswers(nodesRef.current, nodeId))
          return
        }
        setError(cause instanceof Error ? cause.message : '请求模型接口失败')
      } finally {
        setStreamingNodeId(null)
        setStreamingText('')
        controllerRef.current = null
      }
    },
    [apply],
  )

  const createTopic = useCallback(
    (topic: string) => {
      const id = newNodeId()
      const node = createRootNode({ id, topic, createdAt: Date.now() })
      const next = [...nodesRef.current, node]
      apply(next)
      void runStream(id, next)
      return id
    },
    [apply, runStream],
  )

  const askAt = useCallback(
    (input: AskInput) => {
      const id = newNodeId()
      const node = addChildNode({
        id,
        parentId: input.parentId,
        anchor: {
          messageId: input.messageId,
          fragmentIndex: input.fragmentIndex,
          text: input.text,
        },
        question: input.question,
        createdAt: Date.now(),
      })
      const next = [...nodesRef.current, node]
      apply(next)
      void runStream(id, next)
      return id
    },
    [apply, runStream],
  )

  const regenerate = useCallback(
    (nodeId: string) => {
      const cleared = clearAnswers(nodesRef.current, nodeId)
      apply(cleared)
      void runStream(nodeId, cleared)
    },
    [apply, runStream],
  )

  const remove = useCallback(
    (nodeId: string) => {
      apply(removeSubtree(nodesRef.current, nodeId))
    },
    [apply],
  )

  const seedDemo = useCallback(async () => {
    const next = [...createDemoNodes(Date.now()), ...nodesRef.current]
    apply(next)
  }, [apply])

  const stopStreaming = useCallback(() => {
    controllerRef.current?.abort()
  }, [])

  const clearError = useCallback(() => setError(null), [])

  return {
    ready,
    nodes,
    streamingNodeId,
    streamingText,
    error,
    createTopic,
    askAt,
    regenerate,
    remove,
    seedDemo,
    clearError,
    stopStreaming,
  }
}
