// @vitest-environment jsdom
/**
 * 设置页托管模式改造：聊天由服务端托管免 key；API Key 降级为可选（仅语音/附件用）。
 * 验收：文案不再是"开始使用"关卡形态；存在服务端连接状态行。
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root
beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('设置页托管模式文案', () => {
  it('中文文案：API Key 不再是"开始使用"的准入形态，标注为可选能力', async () => {
    const { zh } = await import('../web/src/i18n/zh')
    expect(zh.apiKeyStart).not.toContain('开始使用')
    expect(zh.apiKeyStart).toContain('可选')
  })

  it('英文文案同步降级为 optional', async () => {
    const { en } = await import('../web/src/i18n/en')
    expect(en.apiKeyStart.toLowerCase()).toContain('optional')
  })

  it('存在服务端连接状态的文案键（托管模式提示）', async () => {
    const { zh } = await import('../web/src/i18n/zh') as { zh: Record<string, string> }
    const key = 'serverManagedStatus'
    expect(zh[key]).toBeDefined()
    expect(zh[key]).toContain('服务端')
  })
})

describe('设置页数据管理分组渲染', () => {
  it('渲染服务端连接状态行（模型来自 /api/health）', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/api/health')) {
        return new Response(JSON.stringify({ configured: true, model: 'deepseek-flash', models: [] }), { status: 200 })
      }
      return new Response('{}', { status: 200 })
    }))
    const { setLocale } = await import('../web/src/services/settings')
    setLocale('zh-CN')
    const { ServerStatusCell } = await import('../web/src/components/settings/ServerStatus')
    act(() => { root.render(<ServerStatusCell />) })
    // 等异步 health 拉取落地
    await act(async () => { await new Promise((r) => setTimeout(r, 50)) })
    expect(container.textContent).toContain('deepseek-flash')
    expect(container.textContent).toContain('服务端')
    vi.unstubAllGlobals()
  })
})
