// 会话标题：由模型把「提问 + 回答」压成短语，不直接拿提问原句当标题。
import { describe, expect, it, vi } from 'vitest'
import { cleanTitle, generateTitle, MAX_TITLE_CHARS } from '../server/title.mjs'

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const CONFIG = { baseUrl: 'https://api.example.com/v1', apiKey: 'k-test', model: 'm-test' }

describe('cleanTitle', () => {
  it('去掉引号、换行与句末标点', () => {
    expect(cleanTitle('“复利的数学本质”。\n')).toBe('复利的数学本质')
    expect(cleanTitle('「效用函数」')).toBe('效用函数')
  })

  it('超长标题截断到上限', () => {
    const title = cleanTitle('复'.repeat(80))
    expect(title.length).toBe(MAX_TITLE_CHARS)
  })

  it('空白或纯标点输入返回空串', () => {
    expect(cleanTitle('   \n ')).toBe('')
    expect(cleanTitle('。。！')).toBe('')
    expect(cleanTitle(null)).toBe('')
  })
})

describe('generateTitle', () => {
  it('用模型返回的内容作为标题，并按只回标题的要求提问', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ choices: [{ message: { content: '  “复利与单利之别”。 ' } }] }),
    )
    const title = await generateTitle(
      CONFIG,
      { question: '什么是复利？', answer: '复利是利滚利。' },
      fetchImpl,
    )

    expect(title).toBe('复利与单利之别')

    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe('https://api.example.com/v1/chat/completions')
    expect(init.headers.Authorization).toBe('Bearer k-test')

    const body = JSON.parse(init.body)
    expect(body.model).toBe('m-test')
    // 提示词必须明确「只输出标题」，否则模型容易回一段解释
    expect(body.messages[0].role).toBe('system')
    expect(body.messages[0].content).toContain('标题')
    // 提问与回答都要给到模型，标题才有依据
    const userText = body.messages[1].content
    expect(userText).toContain('什么是复利')
    expect(userText).toContain('复利是利滚利')
  })

  it('提问为空时不请求模型，直接返回空串', async () => {
    const fetchImpl = vi.fn()
    expect(await generateTitle(CONFIG, { question: '  ', answer: 'x' }, fetchImpl)).toBe('')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('模型返回空内容时返回空串，由调用方回退到原提问', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ choices: [{ message: { content: '' } }] }))
    expect(await generateTitle(CONFIG, { question: 'q', answer: 'a' }, fetchImpl)).toBe('')
  })

  it('上游非 2xx 时抛错，调用方可感知失败', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: 'boom' }, 500))
    await expect(generateTitle(CONFIG, { question: 'q', answer: 'a' }, fetchImpl)).rejects.toThrow(
      /500/,
    )
  })

  it('返回内容里不包含密钥', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ choices: [{ message: { content: '复利' } }] }),
    )
    const title = await generateTitle(CONFIG, { question: 'q', answer: 'a' }, fetchImpl)
    expect(title).not.toContain('k-test')
  })
})
