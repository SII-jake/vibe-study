/**
 * 会话标题：交给服务端调模型摘要，前端只发提问与回答。
 * 失败一律降级为空串，由调用方回退到原提问，不打断主流程。
 */

export interface TitleInput {
  question: string
  answer: string
}

export async function fetchTitle(
  input: TitleInput,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const question = input.question.trim()
  if (question === '') return ''

  try {
    const response = await fetchImpl('/api/title', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, answer: input.answer }),
    })
    if (!response.ok) return ''

    const body = (await response.json()) as { title?: unknown }
    return typeof body.title === 'string' ? body.title.trim() : ''
  } catch {
    return ''
  }
}
