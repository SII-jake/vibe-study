import { describe, expect, it } from 'vitest'
import { isConfigured, normalizeBaseUrl, normalizeConfig } from '../src/ai/settings'

describe('normalizeBaseUrl', () => {
  it('去掉结尾斜杠', () => {
    expect(normalizeBaseUrl('https://api.deepseek.com/v1/')).toBe('https://api.deepseek.com/v1')
  })

  it('裸域名补上 /v1', () => {
    expect(normalizeBaseUrl('https://api.deepseek.com')).toBe('https://api.deepseek.com/v1')
  })

  it('已带版本前缀时不再追加', () => {
    expect(normalizeBaseUrl('https://open.bigmodel.cn/api/paas/v4')).toBe(
      'https://open.bigmodel.cn/api/paas/v4',
    )
  })
})

describe('normalizeConfig', () => {
  it('补齐默认值与归一化地址', () => {
    expect(
      normalizeConfig({ baseUrl: 'https://api.deepseek.com/', apiKey: ' k ', model: ' m ' }),
    ).toEqual({
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: 'k',
      model: 'm',
    })
  })

  it('字段缺失时给空串而不是 undefined', () => {
    expect(normalizeConfig({})).toEqual({ baseUrl: '', apiKey: '', model: '' })
  })
})

describe('isConfigured', () => {
  it('密钥与模型齐全才算配置完成', () => {
    expect(isConfigured({ baseUrl: 'https://a/v1', apiKey: 'k', model: 'm' })).toBe(true)
    expect(isConfigured({ baseUrl: 'https://a/v1', apiKey: '', model: 'm' })).toBe(false)
    expect(isConfigured({ baseUrl: 'https://a/v1', apiKey: 'k', model: '' })).toBe(false)
  })
})
