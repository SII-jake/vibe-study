import { isConfigured } from './config.mjs'
import { runAgentTurn } from './agent.mjs'
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
 */
export function createHandler(config, fetchImpl = fetch) {
  return async function handler(request, response) {
    const url = new URL(request.url, 'http://localhost')

    if (request.method === 'GET' && url.pathname === '/api/health') {
      sendJson(response, 200, {
        configured: isConfigured(config),
        model: config.model,
        models: config.models,
      })
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

    const controller = new AbortController()
    request.on('close', () => controller.abort())

    const model = resolveModel(config, payload.model)
    // 配了工具密钥时走 agent 循环；过程中先推工具动作，再推最终回答。
    if (config.serperKey || config.jinaKey) {
      response.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no',
      })
      const writeEvent = (data) => response.write(`data: ${JSON.stringify(data)}\n\n`)
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
            writeEvent({ choices: [{ delta: { content: delta } }] })
          },
          // 模型「先说了话又决定调工具」：那段话不是答案，让前端清掉已显示部分
          () => {
            if (controller.signal.aborted) return
            streamed = ''
            writeEvent({ reset: true })
          },
        )
        if (controller.signal.aborted) return
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
        signal: controller.signal,
      })
    } catch (cause) {
      if (controller.signal.aborted) return
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
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        response.write(value)
      }
    } catch {
      // 客户端断开或上游中断：收尾即可，错误已无从投递。
    } finally {
      response.end()
    }
  }
}
