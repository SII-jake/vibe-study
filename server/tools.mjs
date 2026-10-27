/** 模型可用的外部工具：serper 联网搜索、jina reader 网页正文读取。密钥只在服务端使用。 */

const TOP_RESULTS = 8
const MAX_READ_CHARS = 8000

async function searchWeb(config, query, fetchImpl) {
  const q = String(query ?? '').trim()
  if (q === '') return '搜索词为空'
  if (!config.serperKey) return '搜索工具未配置（缺少 SERPER_KEY）'

  const response = await fetchImpl(`${config.serperBase}/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-KEY': config.serperKey },
    body: JSON.stringify({ q, gl: 'cn', hl: 'zh-cn' }),
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    return `搜索接口返回 ${response.status}${detail ? `：${detail}` : ''}`
  }
  const body = await response.json()
  const items = (body.organic ?? []).slice(0, TOP_RESULTS)
  if (items.length === 0) return '没有搜到相关结果'
  return items
    .map((item, index) => `${index + 1}. ${item.title}\n${item.link}\n${item.snippet ?? ''}`.trim())
    .join('\n\n')
}

async function readUrl(config, url, fetchImpl) {
  const target = String(url ?? '').trim()
  let parsed
  try {
    parsed = new URL(target)
  } catch {
    throw new Error('url 不合法')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('url 必须是 http/https，不能读取其他协议')
  }
  if (!config.jinaKey) return '网页读取工具未配置（缺少 JINA_KEY）'

  const response = await fetchImpl(`${config.jinaBase}/${target}`, {
    headers: { Authorization: `Bearer ${config.jinaKey}` },
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    return `网页读取接口返回 ${response.status}${detail ? `：${detail}` : ''}`
  }
  return (await response.text()).slice(0, MAX_READ_CHARS)
}

/** 执行一次工具调用；工具不可用与上游错误都转为文本结果，交给模型自行解释。 */
export async function executeTool(config, name, args, fetchImpl = fetch) {
  if (name === 'search') return searchWeb(config, args?.query, fetchImpl)
  if (name === 'read_url') return readUrl(config, args?.url, fetchImpl)
  return `未知工具：${name ?? '(空)'}`
}
