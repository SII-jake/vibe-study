#!/usr/bin/env node
/**
 * e2e happy path：把「用户最常用的一条完整链路」在真实浏览器里走一遍。
 *
 * 链路（不依赖模型密钥，全程 demo 数据确定性驱动）：
 *   打开应用 → 载入示例（复利）→ 进会话阅读 → 点选中的锚点原文开分支 →
 *   收起左栏 → 刷新后偏好保持 → 展开恢复
 *
 * 每一步失败即非零退出并打印失败点，供改动后的快速回归：
 *   node scripts/e2e-happy-path.mjs            # 打 vite dev（127.0.0.1:8787）
 *   BASE_URL=https://study.sii.edu.cn node scripts/e2e-happy-path.mjs   # 打 nginx 入口
 *   CHROME_PATH=/path/chrome node scripts/e2e-happy-path.mjs            # 自定义浏览器
 */

import { existsSync } from 'node:fs'
import puppeteer from 'puppeteer-core'

const BASE_URL = process.env.BASE_URL ?? 'http://127.0.0.1:8787'
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  `${process.env.HOME}/.cache/puppeteer/chrome/linux-144.0.7559.96/chrome-linux64/chrome`,
  `${process.env.HOME}/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome`,
  '/usr/bin/chromium',
  '/usr/bin/google-chrome',
].filter(Boolean)
const executablePath = CHROME_CANDIDATES.find((p) => existsSync(p))
if (!executablePath) {
  console.error(`找不到可用浏览器，设 CHROME_PATH 指定。尝试过：${CHROME_CANDIDATES.join(', ')}`)
  process.exit(1)
}

let failed = 0
function check(name, ok, detail = '') {
  const mark = ok ? '✓' : '✗'
  console.log(`  ${mark} ${name}${detail ? `：${detail}` : ''}`)
  if (!ok) failed += 1
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function main() {
  const browser = await puppeteer.launch({
    executablePath,
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 1400, height: 900 })
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(String(error)))

  /**
   * 计算当前态收展按钮（展开态取 collapse、收起态取 expand）与其余
   * 可交互元素的几何重叠。返回重叠控件的可读标签列表；空数组表示无重叠。
   * 放在 main 顶部声明，让启动/收起/展开三处的断言都能引用。
   */
  const overlapOfExpandBtn = () =>
    page.evaluate(() => {
      const probe =
        document.querySelector('.sidebar-expand-btn') ??
        document.querySelector('.sidebar-collapse-btn')
      if (!probe) return ['(收展按钮不存在)']
      const er = probe.getBoundingClientRect()
      const hits = []
      for (const el of document.querySelectorAll('button, a, [role="button"], input, textarea')) {
        if (el === probe) continue
        const r = el.getBoundingClientRect()
        if (r.width === 0 || r.height === 0) continue
        // 4px 容差：忽略纯边缘接触，只算真正压上去的重叠
        const ix = Math.min(er.right, r.right) - Math.max(er.x, r.x)
        const iy = Math.min(er.bottom, r.bottom) - Math.max(er.y, r.y)
        if (ix > 4 && iy > 4) {
          hits.push((el.getAttribute('aria-label') ?? el.textContent ?? el.className).trim().slice(0, 20))
        }
      }
      return hits
    })

  console.log(`[e2e] 目标 ${BASE_URL}，浏览器 ${executablePath}`)

  await page.goto(BASE_URL, { waitUntil: 'networkidle0', timeout: 60_000 })
  await sleep(1500)

  // 初始页：侧栏与会话入口就位
  const boot = await page.evaluate(() => ({
    sidebar: !!document.querySelector('.app-sidebar'),
    collapseBtn: !!document.querySelector('[aria-label="收起左侧栏"]'),
    seedBtn: [...document.querySelectorAll('button')].some((b) => b.textContent.includes('载入示例')),
  }))
  check('应用加载，左侧栏与收起按钮可见', boot.sidebar && boot.collapseBtn)
  check('提供「载入示例」入口（demo 驱动，无需模型）', boot.seedBtn)
  check(
    '（启动即验）收起按钮不与侧栏内容重叠',
    (await overlapOfExpandBtn()).length === 0,
    (await overlapOfExpandBtn()).join('、') || '无重叠',
  )
  const collapsePos = await page.evaluate(() => {
    const btn = document.querySelector('[aria-label="收起左侧栏"]')
    const aside = document.querySelector('.app-sidebar')
    const r = btn?.getBoundingClientRect()
    const ar = aside?.getBoundingClientRect()
    if (!r || !ar) return null
    return { relTop: r.top - ar.top, y: r.y }
  })
  check(
    '（启动即验）收起按钮在侧栏顶部区域（紧邻设置一行，而非被藏到底部）',
    collapsePos !== null && collapsePos.relTop < 64,
    collapsePos ? `距侧栏顶 ${Math.round(collapsePos.relTop)}px` : '不存在',
  )

  // 窄视口（700px，手机）：44px 按钮列退场、主区全宽居中；侧栏改由
  // 页面头部 ☰ 以遮罩形态开合（悬浮展开按钮在手机端隐藏，避免压住
  // 阅读页头部左侧的「返回上一级」按钮）。
  await page.setViewport({ width: 700, height: 900 })
  await page.evaluate(() => window.localStorage.setItem('sidebar-collapsed', '1'))
  await page.reload({ waitUntil: 'networkidle0' })
  await sleep(1200)
  const mobileHome = await page.evaluate(() => {
    const rectOf = (sel) => document.querySelector(sel)?.getBoundingClientRect() ?? null
    const main = rectOf('.app-main')
    const expand = rectOf('.sidebar-expand-btn')
    const menu = rectOf('[aria-label="会话列表"]')
    return {
      vw: window.innerWidth,
      mainX: main?.x ?? -1,
      mainW: main?.width ?? 0,
      expandVisible: !!expand && expand.width > 0 && expand.height > 0,
      menuVisible: !!menu && menu.width > 0 && menu.height > 0,
    }
  })
  check(
    '（手机视口）收起态主区占满全宽，不被按钮列挤偏',
    Math.abs(mobileHome.mainX) < 1 && Math.abs(mobileHome.mainW - mobileHome.vw) < 1,
    `x=${Math.round(mobileHome.mainX)} 宽 ${Math.round(mobileHome.mainW)} / 视口 ${mobileHome.vw}`,
  )
  check('（手机视口）悬浮展开按钮不出现（避免压住页面头部控件）', !mobileHome.expandVisible)
  check('（手机视口）页面头部 ☰ 按钮可见，作为侧栏入口', mobileHome.menuVisible)

  // ☰ 拉开遮罩侧栏；收起按钮仍在遮罩顶部
  await page.evaluate(() => document.querySelector('[aria-label="会话列表"]')?.click())
  await sleep(600)
  const mobileOverlay = await page.evaluate(() => ({
    overlay: !!document.querySelector('.app-sidebar')?.getBoundingClientRect().width,
    collapseVisible: !!document.querySelector('[aria-label="收起左侧栏"]')?.getBoundingClientRect().width,
  }))
  check('（手机视口）点 ☰ 后侧栏遮罩展开', mobileOverlay.overlay)
  check('（手机视口）遮罩上收起入口恒在', mobileOverlay.collapseVisible)

  // 收起后主区恢复全宽
  await page.evaluate(() => document.querySelector('[aria-label="收起左侧栏"]')?.click())
  await sleep(600)
  const mobileRestored = await page.evaluate(() => {
    const main = document.querySelector('.app-main')?.getBoundingClientRect()
    return { vw: window.innerWidth, mainX: main?.x ?? -1, mainW: main?.width ?? 0 }
  })
  check(
    '（手机视口）收起侧栏后主区恢复全宽',
    Math.abs(mobileRestored.mainX) < 1 && Math.abs(mobileRestored.mainW - mobileRestored.vw) < 1,
    `x=${Math.round(mobileRestored.mainX)} 宽 ${Math.round(mobileRestored.mainW)}`,
  )

  // 还原为桌面视口与展开态，再继续后续链路
  await page.setViewport({ width: 1400, height: 900 })
  await page.evaluate(() => window.localStorage.setItem('sidebar-collapsed', '0'))
  await page.reload({ waitUntil: 'networkidle0' })
  await sleep(1200)

  // 载入示例，进入复利会话
  await page.evaluate(() => {
    ;[...document.querySelectorAll('button')].find((b) => b.textContent.includes('载入示例'))?.click()
  })
  await sleep(3000)
  await page.evaluate(() => {
    ;[...document.querySelectorAll('.app-sidebar a, .app-sidebar button')]
      .find((x) => x.textContent.includes('复利是什么'))
      ?.click()
  })
  await sleep(2500)
  const node = await page.evaluate(() => ({
    inNode: location.hash.startsWith('#/n/'),
    fragments: document.querySelectorAll('.fragment').length,
    anchors: [...document.querySelectorAll('mark.anchor-underline[data-node-id]')].map((m) => ({
      text: m.textContent,
      nodeId: m.dataset.nodeId,
    })),
    cards: document.querySelectorAll('.ask-card').length,
  }))
  check('进入会话节点页', node.inNode, locationHash(page))
  check('正文按片段渲染', node.fragments > 0, `${node.fragments} 个片段`)
  check('选中过的锚点原文带分支标记（含 nodeId）', node.anchors.length > 0, `${node.anchors.length} 个`)
  check('锚点下有分支卡片', node.cards > 0, `${node.cards} 张`)

  // 手机视口下的阅读页：☰ 在头部就位、阅读区贴视口左缘；遮罩里选会话
  // 后自动收起遮罩、回到正文不再遮挡。
  await page.setViewport({ width: 700, height: 900 })
  await sleep(600)
  const mobileReader = await page.evaluate(() => {
    const rectOf = (sel) => document.querySelector(sel)?.getBoundingClientRect() ?? null
    const menu = rectOf('.page-reader [aria-label="会话列表"]')
    const main = rectOf('.app-main')
    return { menuVisible: !!menu && menu.width > 0, mainW: main?.width ?? 0, vw: window.innerWidth }
  })
  check('（手机视口）阅读页头部 ☰ 可见', mobileReader.menuVisible)
  check(
    '（手机视口）阅读区铺满视口宽，无按钮列偏移',
    Math.abs(mobileReader.mainW - mobileReader.vw) < 1,
    `宽 ${Math.round(mobileReader.mainW)} / 视口 ${mobileReader.vw}`,
  )
  await page.evaluate(() => document.querySelector('.page-reader [aria-label="会话列表"]')?.click())
  await sleep(600)
  await page.evaluate(() => {
    ;[...document.querySelectorAll('.app-sidebar a, .app-sidebar button')]
      .find((x) => x.textContent.includes('复利是什么'))
      ?.click()
  })
  await sleep(1200)
  const afterPick = await page.evaluate(() => ({
    overlayOpen: !!document.querySelector('.app-sidebar'),
    hash: location.hash,
  }))
  check('（手机视口）遮罩里选完会话自动收起遮罩', !afterPick.overlayOpen)
  check('（手机视口）选完会话停留在节点页', afterPick.hash.startsWith('#/n/'))

  // 还原桌面视口与展开偏好，继续桌面链路
  await page.setViewport({ width: 1400, height: 900 })
  await page.evaluate(() => window.localStorage.setItem('sidebar-collapsed', '0'))
  await page.reload({ waitUntil: 'networkidle0' })
  await sleep(1500)

  // 点锚点文字：与点分支卡片同效，右栏展开子对话
  const target = node.anchors[0]
  const before = await page.evaluate(() => ({
    hash: location.hash,
    rightPanel: !!document.querySelector('.track-right'),
    markers: document.querySelectorAll('.ask-card').length,
  }))
  await page.evaluate((nodeId) => {
    const mark = document.querySelector(`mark.anchor-underline[data-node-id="${nodeId}"]`)
    mark?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  }, target.nodeId)
  await sleep(1500)
  const afterAnchor = await page.evaluate(() => ({
    hash: location.hash,
    rightPanel: !!document.querySelector('.track-right'),
    rightLabel: document.querySelector('.right-label')?.textContent ?? null,
  }))
  check('点锚点文字打开子对话右栏', afterAnchor.rightPanel, afterAnchor.rightLabel ?? '')
  check('路由未被替换（父对话仍在中栏）', afterAnchor.hash === before.hash, afterAnchor.hash)

  // 对照：收起右栏后点分支卡片，行为必须一致
  await page.evaluate(() => document.querySelector('[aria-label="收起子对话"]')?.click())
  await sleep(800)
  await page.evaluate(() => document.querySelector('.ask-card')?.click())
  await sleep(1500)
  const afterCard = await page.evaluate(() => ({
    rightPanel: !!document.querySelector('.track-right'),
    hash: location.hash,
  }))
  check('点分支卡片获得相同行为（右栏、路由不变）', afterCard.rightPanel && afterCard.hash === before.hash)

  // 左栏收起：侧栏消失、阅读区让出、保留一列按钮宽度、偏好落盘
  await page.evaluate(() => document.querySelector('[aria-label="收起左侧栏"]')?.click())
  await sleep(600)
  const collapsed = await page.evaluate(() => ({
    attr: document.querySelector('.app-shell')?.hasAttribute('data-sidebar-collapsed'),
    sidebarGone: !document.querySelector('.app-sidebar'),
    expandBtn: !!document.querySelector('.sidebar-expand-btn'),
    stored: localStorage.getItem('sidebar-collapsed'),
    // 阅读区必须真的活着：模板对不等于几何对——left-width 曾被 grid
    // auto-placement 错塞进 0px 列导致中右栏全被裁掉
    mainWidth: document.querySelector('.app-main')?.getBoundingClientRect().width ?? 0,
    fragmentsVisible: [...document.querySelectorAll('.fragment')].filter(
      (el) => el.getBoundingClientRect().width > 0,
    ).length,
    fragmentCount: document.querySelectorAll('.fragment').length,
  }))
  check('收起左侧栏：标记/侧栏消失/展开按钮出现', collapsed.attr && collapsed.sidebarGone && collapsed.expandBtn)
  check('收起偏好已写入 localStorage', collapsed.stored === '1')
  check('阅读区（中栏）没有被一同收起', collapsed.mainWidth > 0, `app-main 实际宽 ${Math.round(collapsed.mainWidth)}px`)
  check(
    '正文段落仍然可见',
    collapsed.fragmentCount > 0 && collapsed.fragmentsVisible >= collapsed.fragmentCount,
    `${collapsed.fragmentsVisible}/${collapsed.fragmentCount} 可见`,
  )
  const overlapCollapsed = await overlapOfExpandBtn()
  check('（右栏开着时）展开按钮不与阅读区控件重叠', overlapCollapsed.length === 0, overlapCollapsed.join('、') || '无重叠')

  // 刷新：偏好保持收起
  await page.reload({ waitUntil: 'networkidle0' })
  await sleep(1500)
  const reloaded = await page.evaluate(() => ({
    attr: document.querySelector('.app-shell')?.hasAttribute('data-sidebar-collapsed'),
    expandBtn: !!document.querySelector('.sidebar-expand-btn'),
    mainWidth: document.querySelector('.app-main')?.getBoundingClientRect().width ?? 0,
  }))
  check('刷新后左栏偏好保持收起', reloaded.attr && reloaded.expandBtn)
  check('刷新后阅读区仍然活着', reloaded.mainWidth > 0, `app-main 实际宽 ${Math.round(reloaded.mainWidth)}px`)
  const overlapReloaded = await overlapOfExpandBtn()
  check('（仅中栏时）展开按钮不与阅读区控件重叠', overlapReloaded.length === 0, overlapReloaded.join('、') || '无重叠')

  // 展开恢复
  await page.evaluate(() => document.querySelector('.sidebar-expand-btn')?.click())
  await sleep(600)
  const expanded = await page.evaluate(() => ({
    sidebar: !!document.querySelector('.app-sidebar'),
    stored: localStorage.getItem('sidebar-collapsed'),
  }))
  check('点展开按钮恢复左侧栏', expanded.sidebar && expanded.stored === '0')
  check(
    '（展开恢复后）收起按钮不与侧栏内容重叠',
    (await overlapOfExpandBtn()).length === 0,
    (await overlapOfExpandBtn()).join('、') || '无重叠',
  )

  check('全程无页面脚本错误', pageErrors.length === 0, pageErrors[0]?.slice(0, 120) ?? '')

  await browser.close()
  if (failed > 0) {
    console.error(`\n[e2e] 失败 ${failed} 项`)
    process.exit(1)
  }
  console.log('\n[e2e] happy path 全部通过')
}

function locationHash(page) {
  return page.url().split('/').slice(3).join('/')
}

main().catch((error) => {
  console.error('[e2e] 运行失败：', error)
  process.exit(1)
})
