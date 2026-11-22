// 应用内网页预览（真机反馈 2026-11-22）：搜索结果/引用文章点开必须留在壳内，
// 与 DS demo 表现一致；原实现（1.0.8 起）一律扔系统浏览器，跳出应用。
// 原生行为 e2e 抓不到，红线钉在仓库里。
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const mainActivity = readFileSync(
  join(repoRoot, 'android/app/src/main/java/cn/sii/yjzhou/vibestudy/MainActivity.java'),
  'utf8',
)
const manifest = readFileSync(join(repoRoot, 'android/app/src/main/AndroidManifest.xml'), 'utf8')
const previewPath = join(
  repoRoot,
  'android/app/src/main/java/cn/sii/yjzhou/vibestudy/LinkPreviewActivity.java',
)

describe('外链在壳内预览，不跳系统浏览器', () => {
  it('MainActivity 的外部页面入口改为壳内预览（openInSystemBrowser 退役）', () => {
    expect(mainActivity).toContain('openLinkPreview')
    expect(mainActivity).not.toContain('openInSystemBrowser')
  })

  it('两条外链链路（直达导航 / window.open）都走预览，无遗漏', () => {
    // 定义 1 处 + 两个调用点
    expect((mainActivity.match(/openLinkPreview\(/g) ?? []).length).toBeGreaterThanOrEqual(3)
  })

  it('预览 Activity 存在：WebView 承接、可退网页历史', () => {
    expect(existsSync(previewPath)).toBe(true)
    const preview = readFileSync(previewPath, 'utf8')
    expect(preview).toContain('WebView')
    expect(preview).toContain('canGoBack')
    expect(preview).toContain('OnBackPressedCallback')
  })

  it('预览页复用同一枚自签证书指纹放行（不能比主壳更宽）', () => {
    const preview = readFileSync(previewPath, 'utf8')
    expect(preview).toContain('onReceivedSslError')
    expect(preview).toContain('MainActivity.TRUSTED_HOST')
    expect(preview).toContain('MainActivity.certSha256Matches')
  })

  it('Manifest 声明 LinkPreviewActivity（未声明启动即崩）', () => {
    expect(manifest).toContain('.LinkPreviewActivity')
  })
})
