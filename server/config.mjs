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
  }
}

/** 工具端点只去尾斜杠，不做版本补齐。 */
export function stripSlash(input) {
  return (input ?? '').trim().replace(/\/+$/, '')
}

export function isConfigured(config) {
  return config.apiKey !== '' && config.model !== ''
}
