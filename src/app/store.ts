import { useCallback, useEffect, useRef, useState } from 'react'
import { buildChatMessages } from '../domain/chat'
import { addChildNode, type LearnNode, breadcrumb, createRootNode } from '../domain/tree'
import {
  appendAnswer,
  appendUserMessage,
  clearLastAnswer,
  removeSubtree,
} from '../domain/tree-ops'
import { streamChat } from '../ai/provider'
import { effectiveModel, fetchHealth, type ServerHealth, UNKNOWN_HEALTH } from '../ai/health'
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
  streamingStatus: string | null
  error: string | null
  health: ServerHealth
  refreshHealth(): void
  createTopic(topic: string): string
  askAt(input: AskInput): string
  followUp(nodeId: string, question: string): void
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
  const [streamingStatus, setStreamingStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [health, setHealth] = useState<ServerHealth>(UNKNOWN_HEALTH)

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

  const refreshHealth = useCallback(() => {
    void fetchHealth().then(setHealth)
  }, [])

  useEffect(() => {
    refreshHealth()
  }, [refreshHealth])

  const apply = useCallback((next: LearnNode[]) => {
    nodesRef.current = next
    setNodes(next)
    persist(next)
  }, [])

  const runStream = useCallback(
    async (nodeId: string, latestNodes: LearnNode[]) => {
      const current = await fetchHealth()
      setHealth(current)
      if (!current.configured) {
        setError('服务端还没有配置模型接口，联系管理员在 server/.env 里填密钥。')
        return
      }

      const controller = new AbortController()
      controllerRef.current = controller
      setStreamingNodeId(nodeId)
      setStreamingText('')
      setStreamingStatus(null)

      let accumulated = ''
      try {
        await streamChat({
          messages: buildChatMessages(breadcrumb(latestNodes, nodeId)),
          model: effectiveModel(current),
          signal: controller.signal,
          onDelta: (delta) => {
            accumulated += delta
            setStreamingText(accumulated)
            setStreamingStatus(null)
          },
          onStatus: (status) => setStreamingStatus(status),
        })
        if (accumulated.trim() === '') {
          setError('模型没有返回内容，换个模型名或稍后重试。')
          return
        }
        apply(appendAnswer(nodesRef.current, nodeId, accumulated, Date.now()))
      } catch (cause) {
        if (controller.signal.aborted) {
          apply(clearLastAnswer(nodesRef.current, nodeId))
          return
        }
        setError(cause instanceof Error ? cause.message : '请求模型接口失败')
      } finally {
        setStreamingNodeId(null)
        setStreamingText('')
        setStreamingStatus(null)
        controllerRef.current = null
      }
    },
    [apply],
  )

  /** 同节点再追问：不开新分支，问题与回答留在当前节点顺排，上下文含全部历史轮次。 */
  const followUp = useCallback(
    (nodeId: string, question: string) => {
      const next = appendUserMessage(nodesRef.current, nodeId, question, Date.now())
      apply(next)
      void runStream(nodeId, next)
    },
    [apply, runStream],
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
      const cleared = clearLastAnswer(nodesRef.current, nodeId)
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
    streamingStatus,
    error,
    health,
    refreshHealth,
    createTopic,
    askAt,
    followUp,
    regenerate,
    remove,
    seedDemo,
    clearError,
    stopStreaming,
  }
}
