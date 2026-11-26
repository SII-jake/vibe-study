import { translate, type TranslationMessage } from '../../i18n/index.js'
import { readMessageEvent } from './parseEvent.js'
import { readServerSentEvents } from './sse.js'
import type {
  ApiErrorBody,
  CreateMessageRequest,
  FileObject,
  FilePurpose,
  MessageStreamEvent,
} from './types.js'

/** 构建期 API 地址，默认 https://api.deepseek.com；本地开发支持开发服务器代理 */
export const API_ORIGIN = __API_ORIGIN__
/** Anthropic 兼容接口的前缀 */
// vibe-study 适配：聊天代理由 vibe-study 服务端同源提供（密钥服务端托管），
// 语音/文件等其余工具仍走官方 API_ORIGIN（用户自带 key 形态）。
const ANTHROPIC_BASE_URL = `${typeof window !== 'undefined' ? window.location.origin : ''}/anthropic/v1`
/** 引用 Files API 上传的图片、调用 Anthropic 兼容 Files API 时必须携带 */
const FILES_BETA = 'files-api-2025-04-14'

export type ApiErrorKind =
  /** 非 2xx 响应 */
  | 'http'
  /** 流中返回的错误帧（如等待生成超时），随后连接关闭 */
  | 'stream'
  /** 请求没有到达服务端（断网、跨域被拦截等） */
  | 'network'
  /** 流在 message_stop 之前结束 */
  | 'interrupted'
  /** 响应不符合协议（如非 SSE 响应） */
  | 'protocol'

export class ApiError extends Error {
  readonly localMessage?: TranslationMessage

  constructor(
    readonly kind: ApiErrorKind,
    message: string | TranslationMessage,
    readonly status?: number
  ) {
    super(typeof message === 'string' ? message : translate(message.key, message.params))
    this.name = 'ApiError'
    this.localMessage = typeof message === 'string' ? undefined : message
  }
}

const isErrorBody = (value: unknown): value is ApiErrorBody =>
  typeof value === 'object' &&
  value !== null &&
  'error' in value &&
  typeof (value as ApiErrorBody).error?.message === 'string'

const readErrorResponse = async (
  response: Response,
  kind: 'http' | 'protocol' = 'http',
  fallback = response.statusText
): Promise<ApiError> => {
  const text = await response.text().catch(() => '')
  let message = text || fallback
  try {
    const body: unknown = JSON.parse(text)
    if (isErrorBody(body)) {
      message = body.error.message
    }
  } catch {
    // 非 JSON 响应体直接展示原文
  }
  return new ApiError(kind, message, response.status)
}

export const request = async (url: string, init: RequestInit): Promise<Response> => {
  let response: Response
  try {
    response = await fetch(url, init)
  } catch (error) {
    if (init.signal?.aborted) {
      throw error
    }
    throw new ApiError('network', error instanceof Error ? error.message : String(error))
  }
  if (!response.ok) {
    throw await readErrorResponse(response)
  }
  return response
}

const anthropicHeaders = (apiKey: string, beta: boolean): Record<string, string> => ({
  // DeepSeek 兼容接口的鉴权方式，也可使用 Authorization: Bearer。
  'x-api-key': apiKey,
  // Files API 和通过 file_id 引用图片时必传；纯文本聊天无需携带。
  ...(beta ? { 'anthropic-beta': FILES_BETA } : {}),
})

/** 用 GET /models 校验 API Key（不产生费用） */
export const verifyApiKey = async (apiKey: string, signal?: AbortSignal): Promise<void> => {
  await request(`${API_ORIGIN}/models`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${apiKey}` },
    signal,
  })
}

/**
 * POST /anthropic/v1/files 上传附件（不设过期时间，会话里的历史附件一直可用）。
 * purpose 为 null 时不传该字段（图片）；purpose 必须排在 file 之前。
 */
export const uploadFile = async (
  apiKey: string,
  file: File,
  purpose: FilePurpose | null,
  signal?: AbortSignal
): Promise<FileObject> => {
  const form = new FormData()
  if (purpose) {
    form.append('purpose', purpose)
  }
  form.append('file', file)
  const response = await request(`${ANTHROPIC_BASE_URL}/files`, {
    method: 'POST',
    headers: anthropicHeaders(apiKey, true),
    body: form,
    signal,
  })
  return (await response.json()) as FileObject
}

/** DELETE /anthropic/v1/files/{file_id} */
export const deleteFile = async (apiKey: string, fileId: string): Promise<void> => {
  await request(`${ANTHROPIC_BASE_URL}/files/${encodeURIComponent(fileId)}`, {
    method: 'DELETE',
    headers: anthropicHeaders(apiKey, true),
  })
}

const hasFile = (body: CreateMessageRequest) =>
  body.messages.some(
    (message) =>
      typeof message.content !== 'string' &&
      message.content.some((block) => block.type === 'image' || block.type === 'document')
  )

/** 生成任务端点的同源基址：与聊天代理同一进程，故取页面源而非构建期 API_ORIGIN。 */
const TASKS_URL = `${typeof window !== 'undefined' ? window.location.origin : ''}/api/tasks`

/** 生成任务快照：服务端只回状态，内容一律走事件流回放。 */
export type TaskSnapshot = {
  id: string
  status: 'running' | 'done' | 'error' | 'aborted'
  error?: string | null
  /** 任务开始前该回复已有的块数：刷新重连时据此裁回起点再重放，避免重复块 */
  baseBlocks?: number
}

/**
 * POST /api/tasks：把一次生成交给服务端任务。
 * 任务在服务端独立持有上游流，页面刷新只断开订阅、不影响生成——刷新续接的根在这里。
 * id 由调用方给定（= 回复消息 id），它已随会话落盘，刷新后凭它重新订阅即可。
 */
export const createTask = async (
  id: string,
  body: CreateMessageRequest,
  signal?: AbortSignal,
  baseBlocks = 0
): Promise<TaskSnapshot> => {
  const response = await request(TASKS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      // 引用 file_id 时必须带这个 beta 头，由服务端原样转发给上游
      ...(hasFile(body) ? { 'anthropic-beta': FILES_BETA } : {}),
    },
    body: JSON.stringify({ id, baseBlocks, request: { ...body, stream: true } }),
    signal,
  })
  return (await response.json()) as TaskSnapshot
}

/**
 * GET /api/tasks?id=…：404 表示服务端没有这个任务（进程重启或已过期）。
 * 这种情况回 null 而不是抛错——调用方据此把半截回复收成「已停止」。
 */
export const readTask = async (id: string): Promise<TaskSnapshot | null> => {
  let response: Response
  try {
    response = await fetch(`${TASKS_URL}?id=${encodeURIComponent(id)}`, {
      headers: { Accept: 'application/json' },
    })
  } catch (error) {
    throw new ApiError('network', error instanceof Error ? error.message : String(error))
  }
  if (response.status === 404) {
    return null
  }
  if (!response.ok) {
    throw await readErrorResponse(response)
  }
  return (await response.json()) as TaskSnapshot
}

/** DELETE /api/tasks?id=…：让服务端停掉上游（停止生成）。 */
export const cancelTask = async (id: string): Promise<void> => {
  await request(`${TASKS_URL}?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
}

/** 把 SSE 字节流还原成消息事件：message_stop 即结束，断流抛 interrupted。 */
async function* decodeMessageEvents(
  stream: ReadableStream<Uint8Array>,
  signal: AbortSignal
): AsyncGenerator<MessageStreamEvent> {
  for await (const { event: eventName, data } of readServerSentEvents(stream, signal)) {
    let payload: unknown
    try {
      payload = JSON.parse(data)
    } catch {
      if (eventName !== 'error') {
        continue
      }
    }
    if (isErrorBody(payload)) {
      throw new ApiError('stream', payload.error.message)
    }
    if (eventName === 'error') {
      throw new ApiError('stream', data)
    }
    const event = readMessageEvent(payload)
    if (!event) {
      continue
    }
    yield event
    if (event.type === 'message_stop') {
      return
    }
  }
  // 服务端没有提供错误内容时保持为空，不推测断流原因。
  throw new ApiError('interrupted', '')
}

/**
 * GET /api/tasks/events?id=…&since=…：订阅一条生成任务。
 * since 之前的帧不再重放，供刷新/断线后带着游标续上。
 */
export async function* streamTaskEvents(
  id: string,
  since: number,
  signal: AbortSignal
): AsyncGenerator<MessageStreamEvent> {
  const response = await request(`${TASKS_URL}/events?id=${encodeURIComponent(id)}&since=${since}`, {
    headers: { Accept: 'text/event-stream' },
    signal,
  })
  const contentType = response.headers.get('Content-Type') ?? ''
  if (!response.body || !contentType.includes('text/event-stream')) {
    throw await readErrorResponse(response, 'protocol', '')
  }
  yield* decodeMessageEvents(response.body, signal)
}

/**
 * 发起一次流式生成：先在服务端建任务，再订阅它的事件流。
 * apiKey 已不再参与（密钥托管在服务端），保留首参是为了不动既有调用点与测试桩的
 * 位置参数顺序。
 */
export async function* streamMessage(
  _apiKey: string,
  body: CreateMessageRequest,
  signal: AbortSignal,
  taskId: string,
  baseBlocks = 0
): AsyncGenerator<MessageStreamEvent> {
  await createTask(taskId, body, signal, baseBlocks)
  yield* streamTaskEvents(taskId, 0, signal)
}
