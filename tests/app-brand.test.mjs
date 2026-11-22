// 品牌名守护（用户实测）：侧栏/标题禁止遗留 demo 基座的"API usage demo"字样，
// 统一为 vibe study（与安卓启动器名 android strings.xml、启动页 title 一致）。
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('应用品牌名统一', () => {
  it('中英 appName 均为 vibe study，不含 demo 字样', async () => {
    const { zh } = await import('../web/src/i18n/zh')
    const { en } = await import('../web/src/i18n/en')
    expect(zh.appName).toBe('vibe study')
    expect(en.appName).toBe('vibe study')
  })

  it('网页 document.title 不含 demo 字样', () => {
    const html = readFileSync('web/src/index.html', 'utf8')
    const title = html.match(/<title>([^<]*)<\/title>/)?.[1] ?? ''
    expect(title).toBe('vibe study')
    expect(title.toLowerCase()).not.toContain('demo')
  })
})

// 2026-11-22 真机 Debug 窗口：GET /favicon.ico 404（站点从未声明图标，
// 浏览器自动去要 /favicon.ico 而该文件不存在）。声明内联图标后浏览器不再发这个请求。
describe('站点图标声明', () => {
  it('index.html 声明了 rel="icon"，避免浏览器自动请求不存在的 /favicon.ico', () => {
    const html = readFileSync('web/src/index.html', 'utf8')
    expect(html).toMatch(/rel="icon"/)
  })
})
