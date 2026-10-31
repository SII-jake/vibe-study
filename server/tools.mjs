/**
 * 模型可用的外部工具：打包的联网搜索（多关键词检索 + 抓正文一次完成）。
 * 提供方二选一：默认 serper + jina；配置 DEEPSEEK_KEY 后整体切换为
 * DeepSeek search + fetch（同一对外的打包契约与输出格式不变）。
 * 密钥只在服务端使用。
 */

/** 单页抓回的正文上限：够核对摘要与关键事实，又避免超长页面把上下文撑爆。 */
const PAGE_MAX_CHARS = 3000

/** 每个关键词命中的结果只抓前几个页面的正文，其余只留摘要。 */
const FETCH_TOP_RESULTS = 2

/** 单次 search 调用的抓正文总页数上限：词数多时自动放大抓取量的保险丝。 */
const MAX_FETCH_PAGES = 4

/** 摘要条数：与过去保持一致的前 8 条。 */
const TOP_RESULTS = 8

/** 抓一个页面的正文（jina reader）。失败转为文本标注而不是抛错。 */
async function fetchPageJina(config, url, fetchImpl) {
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

/** 抓一个页面的正文（DeepSeek fetch）。失败转为文本标注而不是抛错。 */
async function fetchPageDeepseek(config, url, fetchImpl) {
  try {
    const response = await fetchImpl(`${config.deepseekBase}/v1/tools/fetch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.deepseekKey}` },
      body: JSON.stringify({ url }),
    })
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      return `（正文获取失败：${response.status}${detail ? ` ${detail}` : ''}）`
    }
    const body = await response.json().catch(() => null)
    return String(body?.content ?? '').slice(0, PAGE_MAX_CHARS)
  } catch (cause) {
    return `（正文获取失败：${cause.message}）`
  }
}

/** 当前生效的搜索提供方：deepseek 优先（配了 key 即切换），否则 serper+jina。 */
function resolveProvider(config) {
  if (config.deepseekKey) return { searchOne: searchOneDeepseek, fetchPage: fetchPageDeepseek, canFetch: () => true }
  return { searchOne: searchOneSerper, fetchPage: fetchPageJina, canFetch: () => Boolean(config.jinaKey) }
}

/** 单次 search 实际生效的抓取页数上限：config.fetchPages 显式覆盖（0 = 只检索不抓正文），默认 MAX_FETCH_PAGES。 */
function fetchPagesCap(config) {
  const v = config.fetchPages
  return Number.isInteger(v) && v >= 0 ? v : MAX_FETCH_PAGES
}

/**
 * 打包的联网搜索：多关键词各自检索 + 抓回顶部页面正文，一次完成。
 * 检索与抓取全部并发；同一 URL 无论被几个关键词命中只抓一次。
 */
async function searchAndFetch(config, queries, fetchImpl) {
  const provider = resolveProvider(config)
  if (!config.serperKey && !config.deepseekKey) return '搜索工具未配置（缺少 SERPER_KEY 或 DEEPSEEK_KEY）'

  const searched = new Map()
  const results = await Promise.all(
    queries.map(async (q, index) => {
      if (searched.has(q)) return { q, index, duplicate: true }
      searched.set(q, index)
      return { q, index, ...(await provider.searchOne(config, q, fetchImpl)) }
    }),
  )

  /** 待抓正文页面：按关键词顺序、结果排名去重；词多时封顶，防止抓取量膨胀。 */
  const toFetch = []
  const seenUrls = new Set()
  const cap = fetchPagesCap(config)
  for (const result of results) {
    for (const item of (result.items ?? []).slice(0, FETCH_TOP_RESULTS)) {
      if (toFetch.length >= cap) break
      if (!seenUrls.has(item.link)) {
        seenUrls.add(item.link)
        toFetch.push(item.link)
      }
    }
  }
  const pageContents = new Map()
  if (provider.canFetch()) {
    await Promise.all(
      toFetch.map(async (url) => pageContents.set(url, await provider.fetchPage(config, url, fetchImpl))),
    )
  }

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
    const entries = result.items.map((item, index) => {
      const head = `${index + 1}. ${item.title}\n${item.link}\n${item.snippet ?? ''}`.trim()
      const page = pageContents.get(item.link)
      return page ? `${head}\n正文：\n${page}` : head
    })
    rendered.push(`## ${result.q}\n${entries.join('\n\n')}`)
  }
  return rendered.join('\n\n')
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
  return searchAndFetch(config, queries, fetchImpl)
}
