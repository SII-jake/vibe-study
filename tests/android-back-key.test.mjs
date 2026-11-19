// 系统返回键分层（decisions/2026-11-19 §三.1）：壳按返回键时先问前端——
// 有追问层开着时前端消费事件退一层；主线根层壳走系统默认（退应用）。
// 实现契约：MainActivity 覆写 onBackPressedCallback，向 WebView 注入 JS
// dispatch 'vite-back' 自定义事件；前端 SessionView 按 pane 状态
// preventDefault 与否决定壳走不走默认动作。原生红线钉在仓库里。
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const mainActivity = readFileSync(
  join(repoRoot, 'android/app/src/main/java/cn/sii/yjzhou/vibestudy/MainActivity.java'),
  'utf8',
)

describe('MainActivity：返回键先退层再退应用（vite-back）', () => {
  it('以 OnBackPressedCallback 接管返回键，优先问前端而不是直接 finish', () => {
    expect(mainActivity).toContain('OnBackPressedCallback')
    expect(mainActivity).toContain('getOnBackPressedDispatcher')
  })

  it('向 WebView 注入 vite-back 自定义事件', () => {
    expect(mainActivity).toContain('vite-back')
    expect(mainActivity).toContain('dispatchEvent')
    expect(mainActivity).toContain('evaluateJavascript')
  })

  it('只在启动会话页（非启动页）接管——boot.js 阶段不拦', () => {
    // boot/启动 URL 判定常量存在，避免选服页按返回也被吞
    expect(mainActivity).toContain('isChatPage')
  })
})
