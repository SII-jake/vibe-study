// 样式红线守护（真机反馈修复）：CSS 自定义属性引用必须与 theme.css 的定义闭环，
// 未定义变量会使声明整条失效——AskSheet 曾引用不存在的 --dsw-alias-bg-elevated/
// --dsw-alias-mask，背景与遮罩双双解析失败，弹层半透明叠在背景上。
// 另钉三条追问交互关键样式规则，防止"渲染出了元素但没有样式"静默回退。
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const theme = readFileSync(join(repoRoot, 'web/src/app/theme.css'), 'utf8')
const defined = new Set([...theme.matchAll(/--dsw[-\w]+(?=\s*:)/g)].map((m) => m[0]))

const collectCss = (dir, out = []) => {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) collectCss(path, out)
    else if (entry.endsWith('.module.css')) out.push(path)
  }
  return out
}
const cssFiles = collectCss(join(repoRoot, 'web/src'))

describe('样式红线：--dsw-* 引用必须与 theme.css 闭环', () => {
  it('所有 module.css 引用的 dsw token 在 theme.css 均有定义', () => {
    const missing = []
    for (const file of cssFiles) {
      const src = readFileSync(file, 'utf8')
      for (const token of new Set([...src.matchAll(/var\((--dsw[-\w]+)/g)].map((m) => m[1]))) {
        if (!defined.has(token)) missing.push(`${file}: ${token}`)
      }
    }
    expect(missing).toEqual([])
  })
})

const markdownCss = readFileSync(join(repoRoot, 'web/src/components/markdown/markdown.css'), 'utf8')
const sessionCss = readFileSync(join(repoRoot, 'web/src/components/session/SessionView.module.css'), 'utf8')

describe('样式红线：追问交互关键规则不落空', () => {
  it('被追片段下划线 data-ask-referenced 与返回高亮 data-ask-return（§二.5）', () => {
    expect(markdownCss).toContain('data-ask-referenced')
    expect(markdownCss).toContain('data-ask-return')
  })
  it('片段引子卡 ds-ask-card 有卡片样式而非裸 button 默认', () => {
    expect(markdownCss).toContain('.ds-ask-card')
  })
  it('lane 顶部「返回上一级」条有自己的样式（laneHeader）', () => {
    expect(sessionCss).toContain('.laneHeader')
  })
})

const trackStageCss = readFileSync(
  join(repoRoot, 'web/src/components/session/TrackStage.module.css'),
  'utf8',
)

describe('样式红线：手机滚动链几何（真机反馈——恒走 TrackStage 后 lane 失去确定高度链，整页无法上下滑动）', () => {
  it('.stage 明确占满头部之下剩余高（flex:1 + min-height:0，不依赖隐式 shrink）', () => {
    expect(trackStageCss).toContain('flex: 1')
    expect(trackStageCss).toContain('min-height: 0')
  })
  it('.lane 是 flex 列容器——内层 MessageList 的平台滚动器重新获得确定高度', () => {
    expect(trackStageCss).toContain('display: flex')
    expect(trackStageCss).toContain('flex-direction: column')
  })
  it('桌面右栏包装层 [data-right-pane] 同为 flex 列（滚动链双端同构）', () => {
    expect(sessionCss).toContain('[data-right-pane]')
  })
})
