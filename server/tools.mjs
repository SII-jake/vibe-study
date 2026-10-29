/** 模型可用的外部工具：打包的联网搜索（serper 检索 + jina 抓正文一次完成）。密钥只在服务端使用。 */

/** 单页抓回的正文上限：够核对摘要与关键事实，又避免超长页面把上下文撑爆。 */
const PAGE_MAX_CHARS = 3000

/** 每个关键词命中的结果只抓前几个页面的正文，其余只留摘要。 */
const FETCH_TOP_RESULTS = 2

/** 摘要条数：与过去保持一致的前 8 条。 */
const TOP_RESULTS = 8

/**
 * 抓一个页面的正文（jina reader）。失败返回可标注原因而不是抛错，
 * 单页失败不能让整次打包搜索的结果丢掉。
 */
async function fetchPage(config, url, fetchImpl) {
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

/** 单关键词检索：返回命中的条目数组；接口失败时以错误文本为唯一「条目」。 */
async function searchOne(config, q, fetchImpl) {
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

/**
 * 打包的联网搜索：多关键词各自检索 + 抓回顶部页面正文，一次完成。
 * 检索与抓取全部并发；同一 URL 无论被几个关键词命中只抓一次。
 */
async function searchAndFetch(config, queries, fetchImpl) {
  if (!config.serperKey) return '搜索工具未配置（缺少 SERPER_KEY）'

  const searched = new Map()
  const results = await Promise.all(
    queries.map(async (q, index) => {
      if (searched.has(q)) return { q, index, duplicate: true }
      searched.set(q, index)
      return { q, index, ...(await searchOne(config, q, fetchImpl)) }
    }),
  )

  /** 待抓正文页面：按关键词顺序、结果排名去重。 */
  const toFetch = []
  const seenUrls = new Set()
  for (const result of results) {
    for (const item of (result.items ?? []).slice(0, FETCH_TOP_RESULTS)) {
      if (!seenUrls.has(item.link)) {
        seenUrls.add(item.link)
        toFetch.push(item.link)
      }
    }
  }
  const pageContents = new Map()
  if (config.jinaKey) {
    await Promise.all(
      toFetch.map(async (url) => pageContents.set(url, await fetchPage(config, url, fetchImpl))),
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
