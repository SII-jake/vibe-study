import { createNodeStore, isValidNodesPayload } from './node-store.mjs'
import { apiNeedsAuth } from './auth.mjs'
import { isConfigured } from './config.mjs'
import { createTaskStore } from './task-store.mjs'
import { readBuildInfo } from './build-info.mjs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzip } from 'node:zlib'
import { promisify } from 'node:util'

const gzipAsync = promisify(gzip)

/** 产物目录缺省值：与 server/index.mjs 同口径（仓库内 dist），可用 opts.distDir 覆盖。 */
const DEFAULT_DIST_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist')

/**
 * 按 SSE 帧边界切分上游字节（RFC 兼容：CRLF / LF / CR 三种空行都算一帧结束）。
 * 生成任务按帧记账，重连时才能带着确定的游标续上；按原始分片记账会让
 * 帧边界随网络抖动漂移，续接游标就没有意义。
 */
function splitSseFrames(buffer) {
  const frames = []
  let rest = buffer
  for (;;) {
    const match = /\r\n\r\n|\n\n|\r\r/.exec(rest)
    if (!match) break
    frames.push(rest.slice(0, match.index + match[0].length))
    rest = rest.slice(match.index + match[0].length)
  }
  return { frames, rest }
}

/**
 * 请求体上限（A，真机反馈 2026-11-22 远端 "H3多模态推理优化" 两端不一致）。
 * 原值 1 MB 把同步写口卡死了：该会话单个节点的 web_search_tool_result 就有
 * 657 KB，整库 PUT 体已达 1,046,219 字节，离 1,048,576 只剩 2,357 字节——
 * 再发一轮问答必然超限，写入被丢，另一端永远拿不到。
 * 个人自用规模下 32 MB 足够（nginx 侧 client_max_body_size 为 50m，不是瓶颈）。
 */
const DEFAULT_MAX_BODY_BYTES = 32 * 1024 * 1024

/** 小于这个体积不值得压缩（头部开销可能比省下的还多）。 */
const GZIP_MIN_BYTES = 1024

function acceptsGzip(request) {
  const header = request.headers['accept-encoding']
  return typeof header === 'string' && /\bgzip\b/.test(header)
}

/** 按 If-None-Match 判定是否命中（支持逗号分隔列表、W/ 弱校验前缀与 *）。 */
function etagMatches(header, etag) {
  if (typeof header !== 'string') return false
  return header.split(',').some((part) => {
    const value = part.trim().replace(/^W\//, '')
    return value === '*' || value === etag
  })
}

/**
 * 发送可能被 gzip 的响应。
 * 压缩后长度未知，改回分块传输；不压缩时给出准确 Content-Length。
 */
async function sendMaybeGzip(response, status, text, headers, useGzip) {
  const raw = Buffer.from(text, 'utf8')
  if (!useGzip || raw.length < GZIP_MIN_BYTES) {
    response.writeHead(status, { ...headers, 'Content-Length': raw.length })
    response.end(raw)
    return
  }
  const packed = await gzipAsync(raw)
  response.writeHead(status, {
    ...headers,
    'Content-Encoding': 'gzip',
    Vary: 'Accept-Encoding',
    'Content-Length': packed.length,
  })
  response.end(packed)
}

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

/**
 * 读取请求体（B，同一次真机反馈）。
 * 修复前超限直接 `request.destroy()`：客户端拿不到任何 HTTP 状态码，只看到
 * "fetch failed"，前端把它当网络抖动静默吞掉——写入失败却毫无痕迹。
 * 现在超限后不再断连接：继续消费剩余数据（丢弃，不缓存）后回结构化结果，
 * 调用方据此回可读的 413，客户端能区分"包太大"与"断网"。
 */
function readBody(request, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    let tooLarge = false
    request.on('data', (chunk) => {
      size += chunk.length
      if (size > maxBytes) {
        tooLarge = true
        chunks.length = 0
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => {
      resolve(
        tooLarge
          ? { ok: false, limit: maxBytes, size }
          : { ok: true, body: Buffer.concat(chunks).toString('utf8') },
      )
    })
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
  /** 请求体上限可注入：测试用小值验证超限路径，不必真造 32 MB */
  const maxBodyBytes = opts.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES
  /** 生成任务仓储：任务独立持有上游流，HTTP 连接只是订阅者 */
  const taskStore = opts.taskStore ?? createTaskStore()
  /** 产物目录：健康检查据此报出「这份 dist 由哪次提交编译而来」 */
  const distDir = opts.distDir ?? DEFAULT_DIST_DIR

  /**
   * 起一条上游流并逐帧记账。
   * 关键：中止信号只由任务自己（DELETE）触发；订阅者断开不经过这里，
   * 所以刷新页面不会掐掉上游——这是本次改动的全部要点。
   */
  const runUpstream = async (body, beta, emit, signal) => {
    const upstream = await fetchImpl(`${config.deepseekBase}/anthropic/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.deepseekKey,
        ...(beta ? { 'anthropic-beta': String(beta) } : {}),
      },
      body: JSON.stringify(body),
      signal,
    })
    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => '')
      // 以 error 帧告知订阅方，与代理路径的报错形态一致
      emit(
        `data: ${JSON.stringify({
          type: 'error',
          error: { message: detail || `上游返回 ${upstream.status}` },
        })}\n\n`,
      )
      return
    }
    if (!upstream.body) {
      return
    }
    const reader = upstream.body.getReader()
    // 注入的 fetch 实现可能不响应 signal（测试桩即如此），所以自己也取消读取器
    const onAbort = () => {
      reader.cancel().catch(() => {})
    }
    signal.addEventListener('abort', onAbort, { once: true })
    const decoder = new TextDecoder()
    let buffer = ''
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const { frames, rest } = splitSseFrames(buffer)
        buffer = rest
        for (const frame of frames) {
          emit(frame)
        }
      }
      buffer += decoder.decode()
      if (buffer.trim() !== '') {
        emit(buffer)
      }
    } finally {
      signal.removeEventListener('abort', onAbort)
      try {
        await reader.cancel()
      } catch {
        // 流已结束
      }
    }
  }

  return async function handler(request, response) {
    const url = new URL(request.url, 'http://localhost')

    // 未登录的 API 一律 401 JSON，只放行 /api/auth（登录）与老壳 OTA 检查
    if (apiNeedsAuth(request, auth, url.pathname)) {
      sendJson(response, 401, { error: '未登录' })
      return
    }

    // 多设备同步：整棵问答树读口。
    //
    // 2026-11-22 实测：远端 H3 会话涨到 153 条消息后整库快照 2,244,092 字节，
    // 未压缩且无 304，公网出网带宽约 180 KB/s，每次整棵拉取要 10.9~12.3 秒；
    // 切回标签页/窗口聚焦都会新起一次，主线程被占满，任何新 css/js 请求都排在
    // 后面等——观感就是"这个 css 一直卡死"。这里补两条：
    //   ① gzip：实测 2.24 MB → 0.99 MB，省 56%；
    //   ② ETag/304：版本号未变时直接回 304，切回标签页的绝大多数情况零传输。
    // 版本号是快照的唯一标识（每次 save 递增），因此可以直接做 ETag 依据。
    if (request.method === 'GET' && url.pathname === '/api/nodes') {
      const version = nodeStore.getVersion()
      const body = JSON.stringify({ version, nodes: nodeStore.getNodes() })
      // 内容编码是"所选表示"的一部分：gzip 与 identity 是两个字节流完全不同的
      // 表示（999,743 vs 2,244,092 字节），必须各有自己的实体标签（RFC 9110 §8.8.1）。
      // 2026-11-22 真机 Debug 窗口的 net::ERR_CONTENT_LENGTH_MISMATCH 就是这里：
      // 上一版两个编码共用 "nodes-<版本>"，浏览器缓存按 URL 存条目、用同一 ETag
      // 当校验基准，编码一切换长度对不上，整个请求被判失败。
      //
      // useGzip 必须与 sendMaybeGzip 的实际行为一致：体积小于 GZIP_MIN_BYTES 时
      // 它不压缩，此时表示其实是 identity，标签不能带 -gzip（否则又是标签与
      // 实际编草不符，同一条 MISMATCH 换个体积就复现）。
      const useGzip = acceptsGzip(request) && Buffer.byteLength(body) >= GZIP_MIN_BYTES
      const etag = `"nodes-${version}${useGzip ? '-gzip' : ''}"`
      const commonHeaders = {
        'X-Nodes-Version': String(version),
        ETag: etag,
        // 表示随 Accept-Encoding 变化，所有响应（含 304）都要声明（RFC 9110 §12.5.5），
        // 否则缓存会把 gzip 的响应发给只接受 identity 的客户端。
        Vary: 'Accept-Encoding',
        // 整份快照不做分段传输：明确告知客户端别试 Range，避免它按 Range 续传时
        // 收到整份 200 而误判长度。
        'Accept-Ranges': 'none',
        // private：这是鉴权后的数据，不允许共享缓存留存；
        // no-cache：可以存但必须回源校验，正是 ETag/304 生效的前提。
        'Cache-Control': 'private, no-cache',
      }
      if (etagMatches(request.headers['if-none-match'], etag)) {
        response.writeHead(304, commonHeaders)
        response.end()
        return
      }
      await sendMaybeGzip(
        response,
        200,
        body,
        { 'Content-Type': 'application/json; charset=utf-8', ...commonHeaders },
        useGzip,
      )
      return
    }

    // 多设备同步：整棵问答树写口。乐观锁按 baseVersion 校验，冲突即拒绝并回最新数据。
    if (request.method === 'PUT' && url.pathname === '/api/nodes') {
      let payload
      let read
      try {
        read = await readBody(request, maxBodyBytes)
      } catch {
        sendJson(response, 400, { error: '请求体不是合法 JSON' })
        return
      }
      // 超限回可读的 413（修复前是直接断连接，客户端只见 "fetch failed"）
      if (!read.ok) {
        sendJson(response, 413, { error: '请求体过大', limit: read.limit, size: read.size })
        return
      }
      try {
        payload = JSON.parse(read.body)
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
        // 构建来源来自产物文件，不是运行时 git：旧 dist 冒充新版本正是要核对的场景
        build: await readBuildInfo(distDir),
      })
      return
    }

    // 生成任务（用户 2026-11-26）：把「生成」从 HTTP 连接里摘出来，连接只订阅。
    // 刷新页面 = 断开订阅，上游照跑；带 since 重新订阅即可接上。
    // 任务 id 走查询参数：前端 streamKeyOf 生成的追问键含 NUL，不能进 URL 路径。
    if (url.pathname === '/api/tasks' || url.pathname === '/api/tasks/events') {
      taskStore.sweep()
      const isEvents = url.pathname === '/api/tasks/events'
      const id = url.searchParams.get('id') ?? ''

      if (request.method === 'POST' && !isEvents) {
        if ((config.deepseekKey ?? '') === '') {
          sendJson(response, 503, { error: '服务端未配置 DEEPSEEK_KEY' })
          return
        }
        let read
        try {
          read = await readBody(request, maxBodyBytes)
        } catch {
          sendJson(response, 400, { error: '请求体不是合法 JSON' })
          return
        }
        if (!read.ok) {
          sendJson(response, 413, { error: '请求体过大', limit: read.limit, size: read.size })
          return
        }
        let payload
        try {
          payload = JSON.parse(read.body)
        } catch {
          sendJson(response, 400, { error: '请求体不是合法 JSON' })
          return
        }
        if (typeof payload?.id !== 'string' || payload.id === '' || !payload?.request) {
          sendJson(response, 400, { error: '需要字符串 id 与 request' })
          return
        }
        // baseBlocks：任务开始前该回复已有的块数。刷新重连时据此裁回起点再重放，
        // 否则本地残块与整段回放会叠加出重复内容（续写场景尤其明显）。
        const baseBlocks = Number.isInteger(payload.baseBlocks) ? payload.baseBlocks : 0
        const task = taskStore.create(
          payload.id,
          (emit, signal) =>
            runUpstream(payload.request, request.headers['anthropic-beta'], emit, signal),
          { baseBlocks },
        )
        // 立即回执：任务在后台跑，不等它结束
        sendJson(response, 200, { id: task.id, status: task.status })
        return
      }

      if (request.method === 'GET' && !isEvents) {
        const task = taskStore.get(id)
        if (!task) {
          sendJson(response, 404, { error: '未知任务' })
          return
        }
        sendJson(response, 200, {
          id: task.id,
          status: task.status,
          error: task.error,
          baseBlocks: task.baseBlocks,
        })
        return
      }

      if (request.method === 'GET' && isEvents) {
        if (!taskStore.get(id)) {
          sendJson(response, 404, { error: '未知任务' })
          return
        }
        const since = Number(url.searchParams.get('since') ?? '0')
        response.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          'X-Accel-Buffering': 'no',
          Connection: 'keep-alive',
        })
        // 订阅只读任务已产出的片段：连接断开只退订，绝不回头取消上游。
        let closed = false
        const off = taskStore.subscribe(
          id,
          Number.isFinite(since) ? since : 0,
          (seq, frame) => {
            if (!closed) {
              response.write(`id: ${seq}\n`)
              response.write(frame)
            }
          },
          () => {
            if (!closed) {
              closed = true
              response.end()
            }
          },
        )
        response.on('close', () => {
          closed = true
          off()
        })
        return
      }

      if (request.method === 'DELETE' && !isEvents) {
        taskStore.abort(id)
        const task = taskStore.get(id)
        if (!task) {
          sendJson(response, 404, { error: '未知任务' })
          return
        }
        sendJson(response, 200, { id: task.id, status: task.status })
        return
      }

      sendJson(response, 404, { error: '未知路径' })
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
      let read
      try {
        read = await readBody(request, maxBodyBytes)
      } catch {
        sendJson(response, 400, { error: '请求体不是合法 JSON' })
        return
      }
      if (!read.ok) {
        sendJson(response, 413, { error: '请求体过大', limit: read.limit, size: read.size })
        return
      }
      rawBody = read.body
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
