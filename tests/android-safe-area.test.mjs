// 状态栏 safe-area 守护：手机端「＋新会话」与系统状态栏重叠的真机回归。
// 根因：壳没启用 edge-to-edge，WebView 不扩到状态栏区域，CSS 里
// env(safe-area-inset-top) 全是 0。修一次就不再退：这里把两件原生
// 接线钉死在仓库里（依赖是否装上、Java 是否调用两个层面）。
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

const mainActivity = readFileSync(
  join(repoRoot, 'android/app/src/main/java/cn/sii/yjzhou/vibestudy/MainActivity.java'),
  'utf8',
)
const stylesCss = readFileSync(join(repoRoot, 'src/styles.css'), 'utf8')

describe('系统强制 edge-to-edge 的反制：WebView 回到状态栏之下', () => {
  // 根因：targetSdk 36（Android 15+）强制内容画到状态栏后面，
  // CSS 的 env(safe-area-inset-*) 在 Capacitor WebView 不消费 insets 时恒为 0。
  // 反制口径：decor 适配系统窗口 = WebView 不覆盖状态栏。
  it('MainActivity.onCreate 调 setDecorFitsSystemWindows(window, true)', () => {
    expect(mainActivity).toContain('setDecorFitsSystemWindows(getWindow(), true)')
    expect(mainActivity).toContain('WindowCompat')
  })

  it('不得回退到手动 edge-to-edge（EdgeToEdge.enable 是问题放大器）', () => {
    expect(mainActivity).not.toContain('EdgeToEdge.enable')
  })
})

describe('capacitor.config:StatusBar 插件配置', () => {
  it('声明 overlaysWebView: false（启动时插件同步归位 WebView 布局）', () => {
    const capConfig = readFileSync(join(repoRoot, 'capacitor.config.ts'), 'utf8')
    expect(capConfig).toMatch(/overlaysWebView:\s*false/)
  })
})

describe('StatusBar 插件已真实打包（光装 npm 不进 build 不生效）', () => {
  it('package.json 依赖含 @capacitor/status-bar', () => {
    const packageJson = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'))
    const deps = { ...packageJson.dependencies, ...packageJson.devDependencies }
    expect(deps).toHaveProperty('@capacitor/status-bar')
  })
  it('capacitor.settings.gradle 注册插件子项目', () => {
    const settings = readFileSync(join(repoRoot, 'android/capacitor.settings.gradle'), 'utf8')
    expect(settings).toContain('capacitor-status-bar')
  })
  it('app/build.gradle 依赖插件子项目', () => {
    const appBuild = readFileSync(join(repoRoot, 'android/app/build.gradle'), 'utf8')
    expect(appBuild).toContain("implementation project(':capacitor-status-bar')")
  })
})

describe('reader-head 顶部排版：位置随 safe-area 走', () => {
  it('.reader-head 的 padding-top 使用 safe-top 变量', () => {
    // 修复口径：calc(6px + var(--safe-top)) 或类似的独立 padding-top 声明
    // （不接受 padding: 6px 8px 这种无 safe-top 的四值简写）
    const block = /\.reader-head\s*\{([^}]*)\}/s.exec(stylesCss)?.[1] ?? ''
    expect(block, 'reader-head 缺少带 safe-top 的独立 padding-top').toMatch(
      /padding-top:\s*calc\([^)]*var\(--safe-top\)[^)]*\)/,
    )
  })
})
