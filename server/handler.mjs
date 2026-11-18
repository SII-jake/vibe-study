import { createNodeStore, isValidNodesPayload } from './node-store.mjs'
import { apiNeedsAuth } from './auth.mjs'
import { isConfigured } from './config.mjs'

const MAX_BODY_BYTES = 1024 * 1024

function sendJson(response, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload)
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...extraHeaders,
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

/**
 * 生成请求处理器。
 * 密钥只在这里注入上游请求头，任何响应体都不回传密钥。
 * 新基座（chat-demo）只消费三条通道：/api/nodes 同步、/api/health 健康、/anthropic/v1/messages 代理。
 * 旧链路（/api/chat、/api/chat/resume、/api/title）随旧前端退役。
 */
export function createHandler(config, fetchImpl = fetch, opts = {}) {
  const nodeStore = opts.nodeStore ?? createNodeStore()
  /** 登录判定来自 config.auth —— 未配置口令时全部放行，与引入拦截前一致 */
  const auth = opts.auth ?? config.auth

  return async function handler(request, response) {
    const url = new URL(request.url, 'http://localhost')

    // 未登录的 API 一律 401 JSON，只放行 /api/auth（登录）与老壳 OTA 检查
    if (apiNeedsAuth(request, auth, url.pathname)) {
      sendJson(response, 401, { error: '未登录' })
      return
    }

    // 多设备同步：整棵问答树读口。X-Nodes-Version 头供前端低成本轮询感知远端更新。
    if (request.method === 'GET' && url.pathname === '/api/nodes') {
      sendJson(
        response,
        200,
        { version: nodeStore.getVersion(), nodes: nodeStore.getNodes() },
        { 'X-Nodes-Version': String(nodeStore.getVersion()) },
      )
      return
    }

    // 多设备同步：整棵问答树写口。乐观锁按 baseVersion 校验，冲突即拒绝并回最新数据。
    if (request.method === 'PUT' && url.pathname === '/api/nodes') {
      let payload
      try {
        payload = JSON.parse(await readBody(request))
      } catch {
        sendJson(response, 400, { error: '请求体不是合法 JSON' })
        return
      }
      if (
        !payload ||
        !Number.isInteger(payload.baseVersion) ||
        payload.baseVersion < 0 ||
        !isValidNodesPayload(payload.nodes)
      ) {
        sendJson(response, 400, { error: '需要非负整数 baseVersion 与节点数组' })
        return
      }
      const result = nodeStore.save(payload.nodes, payload.baseVersion)
      if (!result.ok) {
        sendJson(response, 409, { version: result.version, nodes: result.nodes })
        return
      }
      sendJson(response, 200, { version: result.version })
      return
    }

    if (request.method === 'GET' && url.pathname === '/api/health') {
      sendJson(response, 200, {
        configured: isConfigured(config),
        model: config.model,
        models: config.models,
      })
      return
    }

    // DeepSeek 官方 Messages 端点代理（chat-demo 基座用）：
    // 换密钥后请求体与 SSE 流原样透传；demo 前端协议栈（parseEvent/view）无需任何改动。
    if (url.pathname === '/anthropic/v1/messages') {
      if (request.method !== 'POST') {
        sendJson(response, 404, { error: '未知路径' })
        return
      }
      if ((config.deepseekKey ?? '') === '') {
        sendJson(response, 503, { error: '服务端未配置 DEEPSEEK_KEY' })
        return
      }
      let rawBody
      try {
        rawBody = await readBody(request)
      } catch {
        sendJson(response, 400, { error: '请求体不是合法 JSON' })
        return
      }
      let upstream
      try {
        upstream = await fetchImpl(`${config.deepseekBase}/anthropic/v1/messages`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': config.deepseekKey,
            // demo 上传文件/引用 file_id 时客户端会带这个 beta 头，原样转发
            ...(request.headers['anthropic-beta']
              ? { 'anthropic-beta': String(request.headers['anthropic-beta']) }
              : {}),
          },
          body: rawBody,
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
      // SSE 或普通 JSON 都按原始字节透传：demo 的 SSE 解码器要原样的协议帧
      const contentType = upstream.headers.get('content-type') ?? 'application/octet-stream'
      response.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no',
      })
      if (!upstream.body) {
        response.end()
        return
      }
      const reader = upstream.body.getReader()
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          response.write(value)
        }
      } finally {
        try {
          await reader.cancel()
        } catch {
          // 流已结束或客户端断开
        }
        response.end()
      }
      return
    }

    // 其余路径一律 404（旧链路 /api/chat、/api/chat/resume、/api/title 已退役）
    sendJson(response, 404, { error: '未知路径' })
  }
}
