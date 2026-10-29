import { isConfigured } from './config.mjs'
import { runAgentTurn, createSseParser } from './agent.mjs'
import {
  clearOldEntries,
  computeStreamKey,
  createStreamStore,
} from './stream-store.mjs'
import { generateTitle } from './title.mjs'

const MAX_BODY_BYTES = 1024 * 1024

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload)
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  })
  response.end(body)
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    request.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('请求体过大'))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    request.on('error', reject)
  })
}

/** 客户端只能从白名单里挑模型，避免被借道调用任意模型。 */
function resolveModel(config, requested) {
  if (typeof requested === 'string' && config.models.includes(requested)) return requested
  return config.model
}

/**
 * 生成请求处理器。
 * 密钥只在这里注入上游请求头，任何响应体都不回传密钥。
 *
 * opts.streamStore 仅供测试注入；生产默认新建一个。客户端断开不再连带
 * 中止生成：gen 跑完写入残迹，前端可按 streamKey 拉回完整回答。
 */
export function createHandler(config, fetchImpl = fetch, opts = {}) {
  const streamStore = opts.streamStore ?? createStreamStore()

  return async function handler(request, response) {
    const url = new URL(request.url, 'http://localhost')

    // 每次进来顺手清一次过窗残迹，陈旧记录不一直占着
    clearOldEntries(streamStore.entries, streamStore.ttlMs)

    if (request.method === 'GET' && url.pathname === '/api/health') {
      sendJson(response, 200, {
        configured: isConfigured(config),
        model: config.model,
        models: config.models,
      })
      return
    }

    // 断线续传：按 streamKey 返回已生成或仍在进行中的残迹的完整文本。
    if (request.method === 'POST' && url.pathname === '/api/chat/resume') {
      let payload
      try {
        payload = JSON.parse(await readBody(request))
      } catch {
        sendJson(response, 400, { error: '请求体不是合法 JSON' })
        return
      }
      if (!payload || typeof payload.streamKey !== 'string' || payload.streamKey.trim() === '') {
        sendJson(response, 400, { error: 'streamKey 必须是非空字符串' })
        return
      }
      const entry = streamStore.get(payload.streamKey.trim())
      if (!entry) {
        sendJson(response, 404, { error: '没有这个生成残迹' })
        return
      }
      sendJson(response, 200, { content: entry.content, status: entry.status })
      return
    }

    // 会话标题：把「提问 + 回答」压成短语；失败由前端回退到原提问。
    if (request.method === 'POST' && url.pathname === '/api/title') {
      if (!isConfigured(config)) {
        sendJson(response, 503, { error: '服务端未配置模型接口' })
        return
      }

      let payload
      try {
        payload = JSON.parse(await readBody(request))
      } catch {
        sendJson(response, 400, { error: '请求体不是合法 JSON' })
        return
      }
      if (!payload || typeof payload.question !== 'string' || payload.question.trim() === '') {
        sendJson(response, 400, { error: 'question 必须是非空字符串' })
        return
      }

      try {
        const title = await generateTitle(
          { ...config, model: resolveModel(config, payload.model) },
          { question: payload.question, answer: payload.answer },
          fetchImpl,
        )
        sendJson(response, 200, { title })
      } catch (cause) {
        sendJson(response, 502, { error: `生成标题失败：${cause.message}` })
      }
      return
    }

    if (request.method !== 'POST' || url.pathname !== '/api/chat') {
      sendJson(response, 404, { error: '未知路径' })
      return
    }

    if (!isConfigured(config)) {
      sendJson(response, 503, { error: '服务端未配置模型接口' })
      return
    }

    let payload
    try {
      payload = JSON.parse(await readBody(request))
    } catch {
      sendJson(response, 400, { error: '请求体不是合法 JSON' })
      return
    }
    if (!payload || !Array.isArray(payload.messages) || payload.messages.length === 0) {
      sendJson(response, 400, { error: 'messages 必须是非空数组' })
      return
    }

    const model = resolveModel(config, payload.model)
    /** 这次生成的残迹 key：同一份请求（同一消息与模型）无论何时来都能得到同一份结果。 */
    const streamKey = computeStreamKey({ messages: payload.messages, model })
    // 断开不再连带中止：生成跑完写入残迹，前端随后能按 key 拉回 —— 这是续传的前提。
    const controller = new AbortController()

    // 配了工具密钥时走 agent 循环；过程中先推工具动作，再推最终回答。
    if (config.serperKey || config.jinaKey) {
      response.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no',
      })
      const writeEvent = (data) => response.write(`data: ${JSON.stringify(data)}\n\n`)
      response.on('close', () => {
        // 客户端断开时通知 store 完不了事；生成自己跑完要由残迹接手
        response.destroyed = true
      })
      streamStore.begin(streamKey, { content: '' })
      try {
        /** 已经推给前端的增量文本，用于判断是否需要在收尾补一条兜底文案 */
        let streamed = ''
        const result = await runAgentTurn(
          { ...config, model },
          payload.messages,
          fetchImpl,
          (step) => {
            const label =
              step.tool === 'search'
                ? `正在搜索：${step.detail}`
                : step.tool === 'read_url'
                  ? `正在读取：${step.detail}`
                  : null
            if (label) writeEvent({ status: label })
          },
          // 增量直接透传：前端因此边收边渲染，而不是等全文到齐再看一次闪现
          (delta) => {
            if (controller.signal.aborted) return
            streamed += delta
            streamStore.append(streamKey, delta)
            writeEvent({ choices: [{ delta: { content: delta } }] })
          },
          // 模型「先说了话又决定调工具」：那段话不是答案，让前端清掉已显示部分
          () => {
            if (controller.signal.aborted) return
            streamed = ''
            streamStore.reset(streamKey)
            writeEvent({ reset: true })
          },
        )
        if (result.content.trim() !== '') streamStore.finish(streamKey)
        // 一个增量都没吐出来（如上游直接空回）时补一条兜底，避免界面空白
        if (streamed.trim() === '' && result.content.trim() === '') {
          writeEvent({ choices: [{ delta: { content: '这次没有得到回答，再试一次。' } }] })
        }
      } catch (cause) {
        // 不能静默吞错：之前这里没有日志，出问题只能靠猜
        console.error('[study-api] /api/chat agent 失败:', cause?.stack ?? cause)
        const reason = cause instanceof Error ? cause.message : String(cause)
        writeEvent({ error: reason })
        writeEvent({ choices: [{ delta: { content: '服务暂时异常，请稍后重试。' } }] })
      }
      response.write('data: [DONE]\n\n')
      response.end()
      return
    }

    // 转发分支（未配工具密钥）：单纯透传上游，但客户端断开不能让生成中止，
    // 否则和 agent 分支同样的需求场景下断线续传也拿不到完整回答。
    streamStore.begin(streamKey, { content: '' })
    let upstream
    try {
      upstream = await fetchImpl(`${config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: resolveModel(config, payload.model),
          messages: payload.messages,
          stream: true,
        }),
      })
    } catch (cause) {
      sendJson(response, 502, { error: `请求上游失败：${cause.message}` })
      return
    }

    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => '')
      sendJson(response, upstream.status, { error: detail || `上游返回 ${upstream.status}` })
      return
    }
    if (!upstream.body) {
      sendJson(response, 502, { error: '上游未返回数据流' })
      return
    }

    response.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })

    const reader = upstream.body.getReader()
    const sse = createSseParser()
    const decoder = new TextDecoder()
    let upstreamDone = false
    try {
      while (!upstreamDone) {
        const { done, value } = await reader.read()
        if (done) break
        response.write(value)
        // 边转发边把增量收进残迹：客户端断开后剩下的数据仍完整落进 store
        for (const data of sse.push(decoder.decode(value, { stream: true }))) {
          if (data === '[DONE]') {
            upstreamDone = true
            continue
          }
          try {
            const parsed = JSON.parse(data)
            const delta = parsed.choices?.[0]?.delta?.content
            if (typeof delta === 'string' && delta !== '') streamStore.append(streamKey, delta)
          } catch {
            // 非 JSON 心跳行：只透传、不暂停转发
          }
        }
      }
      streamStore.finish(streamKey)
    } finally {
      try {
        await reader.cancel()
      } catch {
        // 流已结束或已销毁，取消失败无需处理
      }
      response.end()
    }
  }
}
