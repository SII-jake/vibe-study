/**
 * 会话标题：把「用户提问 + 模型回答」压成一个短语，作为会话列表与面包屑的标题。
 * 直接拿提问原句当标题，遇到长提问或口语化提问就没法扫读，所以交给模型摘要。
 * 密钥只在这里注入，前端拿不到。
 */

export const MAX_TITLE_CHARS = 24

/** 提示词要求只回标题本身，避免模型附上一段解释把列表撑乱。 */
const SYSTEM_PROMPT = [
  '你负责给一段学习对话起标题。',
  `只输出标题本身，不超过 ${MAX_TITLE_CHARS} 个字，不要引号、不要句号、不要解释。`,
  '标题要概括这段对话真正在讲的知识点，而不是复述用户的问法。',
  '例如用户问「为什么顺风骑车也感觉吃力？」，标题应是「顺风骑行的阻力来源」。',
].join('')

const TRAILING_PUNCT = /[。．.，,、；;：:！!？?…\s]+$/u
const LEADING_PUNCT = /^[。．.，,、；;：:！!？?…\s]+/u
const EDGE_QUOTES = /^["'“”‘’「」『』《》]+|["'“”‘’「」『』《》]+$/gu

/**
 * 清掉模型偶尔带出的引号、换行与句末标点，并截到上限。
 * 引号与标点会互相遮挡（如 `“标题”。` 的 `”` 在 `。` 里面），所以要反复剥到稳定。
 */
export function cleanTitle(input) {
  let text = String(input ?? '')
    .replace(/\s+/g, ' ')
    .trim()

  for (let round = 0; round < 4; round += 1) {
    const before = text
    text = text.replace(EDGE_QUOTES, '').trim()
    text = text.replace(LEADING_PUNCT, '').replace(TRAILING_PUNCT, '').trim()
    if (text === before) break
  }

  if (text === '') return ''
  return text.slice(0, MAX_TITLE_CHARS)
}

/**
 * 生成会话标题。
 * 提问为空时不请求模型；模型返回空内容时返回空串，由调用方回退到原提问。
 */
export async function generateTitle(config, { question, answer }, fetchImpl = fetch) {
  const q = String(question ?? '').trim()
  if (q === '') return ''

  const a = String(answer ?? '').trim()
  const userText = [`用户提问：${q}`, `回答：${a === '' ? '(暂无回答)' : a.slice(0, 2000)}`].join('\n\n')

  const response = await fetchImpl(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userText },
      ],
    }),
  })

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`标题接口返回 ${response.status}${detail ? `：${detail}` : ''}`)
  }

  const body = await response.json().catch(() => null)
  return cleanTitle(body?.choices?.[0]?.message?.content)
}
