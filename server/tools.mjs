/**
 * 模型可用的外部工具：联网搜索（多关键词检索一次完成，返回摘要）。
 * search 是纯检索，永不抓正文；正文抓取只有一条触发路径——
 * 用户消息里给出了具体网页链接（agent 层扫描消息后调 fetchUserUrls，走 jina）。
 * 检索提供方二选一：默认 serper；配置 DEEPSEEK_KEY 后切换为 DeepSeek search
 * （返回条目带 600-800 字模型可读长摘要）。密钥只在服务端使用。
 */

/** 单页抓回的正文上限：够核对摘要与关键事实，又避免超长页面把上下文撑爆。 */
const PAGE_MAX_CHARS = 3000

/** 摘要条数：与过去保持一致的前 8 条。 */
const TOP_RESULTS = 8

/** 抓一个页面的正文（jina reader）。失败转为文本标注而不是抛错。 */
async function fetchPageJina(config, url, fetchImpl) {
  if (!config.jinaKey) return '（正文获取失败：未配置 JINA_KEY）'
  try {
    const response = await fetchImpl(`${config.jinaBase}/${url}`, {
      headers: { Authorization: `Bearer ${config.jinaKey}` },
    })
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      return `（正文获取失败：${response.status}${detail ? ` ${detail}` : ''}）`
    }
    return (await response.text()).slice(0, PAGE_MAX_CHARS)
  } catch (cause) {
    return `（正文获取失败：${cause.message}）`
  }
}

/** 单关键词检索（serper）：返回命中的条目数组；接口失败时以错误文本标注。 */
async function searchOneSerper(config, q, fetchImpl) {
  const response = await fetchImpl(`${config.serperBase}/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-KEY': config.serperKey },
    body: JSON.stringify({ q, gl: 'cn', hl: 'zh-cn' }),
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    return { error: `搜索接口返回 ${response.status}${detail ? `：${detail}` : ''}` }
  }
  const body = await response.json()
  return { items: (body.organic ?? []).slice(0, TOP_RESULTS) }
}

/** 单关键词检索（DeepSeek search）：返回归一化为 { title, link, snippet, summary } 的条目数组。 */
async function searchOneDeepseek(config, q, fetchImpl) {
  const response = await fetchImpl(`${config.deepseekBase}/v1/tools/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.deepseekKey}` },
    body: JSON.stringify({ query: q, count: TOP_RESULTS }),
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    return { error: `搜索接口返回 ${response.status}${detail ? `：${detail}` : ''}` }
  }
  const body = await response.json()
  // 归一化到与 serper 条目相同的形状（link），下游渲染与抓取管线不用分叉；
  // summary 是 600-800 字模型可读长摘要，一并保留给模型
  const items = (body.results ?? []).slice(0, TOP_RESULTS).map((item) => ({
    title: item.title,
    link: item.url,
    snippet: [item.summary ?? '', item.snippet ?? ''].filter(Boolean).join(' — '),
  }))
  return { items }
}

/**
 * 联网搜索：多关键词各自检索一次完成，只返回标题、链接与摘要。
 * 正文抓取不在 search 的职责里（唯一触发路径见文件头说明）。
 */
async function searchWeb(config, queries, fetchImpl) {
  const searchOne = config.deepseekKey ? searchOneDeepseek : searchOneSerper
  if (!config.serperKey && !config.deepseekKey) return '搜索工具未配置（缺少 SERPER_KEY 或 DEEPSEEK_KEY）'

  const searched = new Map()
  const results = await Promise.all(
    queries.map(async (q, index) => {
      if (searched.has(q)) return { q, index, duplicate: true }
      searched.set(q, index)
      return { q, index, ...(await searchOne(config, q, fetchImpl)) }
    }),
  )

  /** 关键词去重后的报告；重复关键词指向第一份结果，不重复展开。 */
  const rendered = []
  for (const result of results) {
    if (result.duplicate) continue
    if (result.error) {
      rendered.push(`## ${result.q}\n${result.error}`)
      continue
    }
    if (!result.items || result.items.length === 0) {
      rendered.push(`## ${result.q}\n没有搜到相关结果`)
      continue
    }
    const entries = result.items.map((item, index) =>
      `${index + 1}. ${item.title}\n${item.link}\n${item.snippet ?? ''}`.trim())
    rendered.push(`## ${result.q}\n${entries.join('\n\n')}`)
  }
  return rendered.join('\n\n')
}

/**
 * 抓回用户消息里给出的网页正文（jina，并发）。
 * 返回 [{ url, content }]：成功为正文（截 PAGE_MAX_CHARS）；
 * 单页失败以「（正文获取失败：…）」回填，交模型自行解释，不静默丢弃。
 */
export async function fetchUserUrls(config, urls, fetchImpl = fetch) {
  return Promise.all(
    urls.map(async (url) => ({ url, content: await fetchPageJina(config, url, fetchImpl) })),
  )
}

/** 兼容模型偶尔发出的单字符串 query：归一为数组。 */
function normalizeQueries(args) {
  const list = args?.queries ?? (typeof args?.query === 'string' ? [args.query] : [])
  return [...new Set(list.map((q) => String(q ?? '').trim()).filter((q) => q !== ''))]
}

/** 执行一次工具调用；工具不可用与上游错误都转为文本结果，交给模型自行解释。 */
export async function executeTool(config, name, args, fetchImpl = fetch) {
  if (name !== 'search') return `未知工具：${name ?? '(空)'}`
  const queries = normalizeQueries(args)
  if (queries.length === 0) return '搜索关键词为空（需要 queries 数组）'
  return searchWeb(config, queries, fetchImpl)
}
