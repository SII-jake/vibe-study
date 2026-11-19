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
