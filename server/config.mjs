/** 服务端配置：全部来自环境变量，密钥只在服务进程内存里存在。 */

/** 解析 .env 风格的键值文本，忽略注释与空行。 */
export function parseEnvFile(text) {
  const result = {}
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (line === '' || line.startsWith('#')) continue
    const separator = line.indexOf('=')
    if (separator < 0) continue
    const key = line.slice(0, separator).trim()
    const value = line
      .slice(separator + 1)
      .trim()
      .replace(/^(['"])(.*)\1$/, '$2')
      .trim()
    if (key !== '') result[key] = value
  }
  return result
}

/** 归一化上游地址：去尾斜杠；裸域名补 `/v1`，已带版本段的不再追加。 */
export function normalizeBaseUrl(input) {
  const trimmed = (input ?? '').trim().replace(/\/+$/, '')
  if (trimmed === '') return ''
  return /\/v\d+$/.test(trimmed) || /\/api\/\w+\/v\d+$/.test(trimmed) ? trimmed : `${trimmed}/v1`
}

function splitList(input) {
  return (input ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '')
}

export function loadServerConfig(source = process.env) {
  return {
    baseUrl: normalizeBaseUrl(source.AI_BASE_URL),
    apiKey: (source.AI_API_KEY ?? '').trim(),
    model: (source.AI_MODEL ?? '').trim(),
    models: splitList(source.AI_MODELS),
    serperKey: (source.SERPER_KEY ?? '').trim(),
    serperBase: stripSlash(source.SERPER_BASE ?? 'https://google.serper.dev'),
    jinaKey: (source.JINA_KEY ?? '').trim(),
    jinaBase: stripSlash(source.JINA_BASE ?? 'https://r.jina.ai'),
    /** 单次上游请求的超时上限（ms）。模型冷启会慢，但挂起的请求不能无限等。 */
    llmTimeoutMs: parseTimeoutMs(source.LLM_TIMEOUT_MS),
    auth: {
      /** 口令为空 = 登录门卫关闭（内网自用）；配置后全站与 API 一律登录后才能访问。 */
      enabled: (source.ACCESS_PASSWORD ?? '').trim() !== '',
      password: (source.ACCESS_PASSWORD ?? '').trim(),
      cookie: (source.AUTH_COOKIE ?? 'vibe_auth').trim() || 'vibe_auth',
      ttlDays: parseTtlDays(source.AUTH_TTL_DAYS),
      secure: (source.AUTH_SECURE ?? 'true').trim().toLowerCase() !== 'false',
    },
  }
}

const DEFAULT_LLM_TIMEOUT_MS = 60_000
const DEFAULT_AUTH_TTL_DAYS = 30

/** 会话有效天数：缺省 30 天；非法输入一律落回默认，登录态不该因手滑变短。 */
function parseTtlDays(raw) {
  if (raw === undefined || raw === '') return DEFAULT_AUTH_TTL_DAYS
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_AUTH_TTL_DAYS
  return Math.round(value)
}

/** 合法的正值毫秒数就采用；缺省或非法输入一律落回默认，不静默变体。 */
function parseTimeoutMs(raw) {
  if (raw === undefined || raw === '') return DEFAULT_LLM_TIMEOUT_MS
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_LLM_TIMEOUT_MS
  return Math.round(value)
}

/** 工具端点只去尾斜杠，不做版本补齐。 */
export function stripSlash(input) {
  return (input ?? '').trim().replace(/\/+$/, '')
}

export function isConfigured(config) {
  return config.apiKey !== '' && config.model !== ''
}
