// 真机反馈①②⑤（2026-11-20 第四轮）壳侧红线：
// ① 查看引用文章后返回"直接回到新会话"——根因是 window.open('_blank')
//   的外链被 WebView 自己承接并留下历史，返回时页面像被重置。外部页面
//   一律转交系统浏览器，WebView 不再产生外部历史。
// ② 新会话页滑动返回会翻出"选择服务器"页——boot.js 从本地启动资产跳
//   到远程会话页后 WebView 历史里躺着选服页。会话页返回键只负责退追问
//   层（vite-back），无层时按无操作处理，绝不再走 WebView 历史回退。
// ⑤ 白底下时间/电量看不见——应用只有浅色主题，状态栏必须显式声明
//   "浅色状态栏（深色图标）"，不能像其他 App 那样靠系统自动推断。
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const mainActivity = readFileSync(
  join(repoRoot, 'android/app/src/main/java/cn/sii/yjzhou/vibestudy/MainActivity.java'),
  'utf8',
)

describe('MainActivity：窗口与系统栏策略（真机反馈①②⑤）', () => {
  it('window.open 的目标 URL 被壳接住：外链交系统浏览器，内链原位加载（①）', () => {
    expect(mainActivity).toContain('onCreateWindow')
    expect(mainActivity).toContain('Intent.ACTION_VIEW')
    expect(mainActivity).toContain('BridgeWebChromeClient')
  })

  it('WebViewClient 同步拦非同源 http(s) 导航（①的直达链路）', () => {
    expect(mainActivity).toContain('shouldOverrideUrlLoading')
    expect(mainActivity).toContain('isExternalHttpUrl')
  })

  it('会话页返回键不再触发 WebView 历史回退（②：无层按无操作处理）', () => {
    // 只有非会话页（boot 选服页）才交还系统默认分发
    expect(mainActivity).toContain('!isChatPage()')
    expect(mainActivity).toContain('vite-back')
  })

  it('状态栏显式浅色（深色图标），白底时间/电量可读（⑤）', () => {
    expect(mainActivity).toContain('setAppearanceLightStatusBars(true)')
  })
})
