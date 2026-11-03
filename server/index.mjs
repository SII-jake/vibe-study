import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { isConfigured, loadServerConfig, withEnvSource } from './config.mjs'
import { createHandler } from './handler.mjs'
import { createAppVersionHandler } from './app-version.mjs'
import { createStaticHandler } from './static.mjs'

const here = dirname(fileURLToPath(import.meta.url))

const config = loadServerConfig(withEnvSource(process.env, () => readFileSync(join(here, '.env'), 'utf8')))
const port = Number(process.env.PORT ?? 8787)
const host = process.env.HOST ?? '127.0.0.1'
/** 产物目录默认取仓库内 dist，可用 DIST_DIR 覆盖；反向代理只认端口，不认路径。 */
const distDir = process.env.DIST_DIR ?? join(here, '..', 'dist')

if (!isConfigured(config)) {
  console.warn('[study-api] 未配置 AI_API_KEY 或 AI_MODEL，/api/chat 将返回 503。')
}

const apiHandler = createHandler(config)
const appVersionHandler = createAppVersionHandler(distDir)
const staticHandler = createStaticHandler(distDir)

createServer((request, response) => {
  const { pathname } = new URL(request.url, 'http://localhost')
  // 壳内检查更新专用端点：与 /api/chat 的 AI 配置无关，未配密钥也要可用
  if (pathname === '/api/app-version') {
    void appVersionHandler(request, response)
    return
  }
  if (pathname === '/api' || pathname.startsWith('/api/')) {
    void apiHandler(request, response)
    return
  }
  void staticHandler(request, response)
}).listen(port, host, () => {
  console.log(`[study-api] 监听 http://${host}:${port}`)
  console.log(`[study-api] 上游 ${config.baseUrl || '(未配置)'}，模型 ${config.model || '(未配置)'}`)
  console.log(`[study-api] 静态产物 ${distDir}`)
})
