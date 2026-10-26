import { describe, expect, it } from 'vitest'
import { createSseDecoder } from '../src/ai/sse'

describe('createSseDecoder', () => {
  it('按行切出 data 负载', () => {
    const decoder = createSseDecoder()
    expect(decoder.push('data: {"a":1}\n\n')).toEqual([{ data: '{"a":1}' }])
  })

  it('跨 chunk 的半行先缓存，凑齐后输出', () => {
    const decoder = createSseDecoder()
    expect(decoder.push('data: {"a"')).toEqual([])
    expect(decoder.push(':1}\n\n')).toEqual([{ data: '{"a":1}' }])
  })

  it('忽略注释行与空行', () => {
    const decoder = createSseDecoder()
    expect(decoder.push(': keep-alive\n\ndata: [DONE]\n\n')).toEqual([{ data: '[DONE]' }])
  })

  it('一次 chunk 内多个事件按顺序返回', () => {
    const decoder = createSseDecoder()
    expect(decoder.push('data: one\n\ndata: two\n\n').map((e) => e.data)).toEqual(['one', 'two'])
  })
})
