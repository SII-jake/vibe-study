// 启动页可选更新界面（真机诉求 2026-11-23）：发现新版不再一律强制下载，
// 而是「现在更新 / 以后再说」。这里驱动 android-shell/index.html 的真实内联脚本，
// 验证按钮现身、点击分流与「以后再说」的记忆——纯逻辑已由 boot-ota.test.mjs 覆盖。
// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const shellDir = join(dirname(fileURLToPath(import.meta.url)), '../android-shell')
const bootSrc = readFileSync(join(shellDir, 'boot.js'), 'utf8')
const html = readFileSync(join(shellDir, 'index.html'), 'utf8')
// 只取 <body> 里的元素，脚本体单独取出后用 new Function 执行（<script src> 在 jsdom 里不加载）
const bodyHtml = html
  .slice(html.indexOf('<body>') + '<body>'.length, html.indexOf('</body>'))
  .replace(/<script[\s\S]*?<\/script>/g, '')
const inlineSrc = /<script>\n([\s\S]*?)<\/script>/.exec(html)[1]

const SERVER = 'https://x.test'
const OPTIONAL = {
  versionName: '1.0.16',
  versionCode: 10016000,
  apkName: 'vibe-study-1.0.16-release.apk',
  sha256: 'bb'.repeat(32),
  serverVersion: '1.0.16.1',
  minVersionCode: 10015000,
}
const MANDATORY = { ...OPTIONAL, minVersionCode: 10016000 }

let submissions = []

function mount({
  versionCode = 10015000,
  published = OPTIONAL,
  permission = true,
  dismissed,
} = {}) {
  const bridge = {
    getVersionCode: () => versionCode,
    getVersionName: () => '1.0.15',
    hasUpdatePermission: () => permission,
    openUpdatePermissionSettings: vi.fn(),
    downloadAndInstall: vi.fn(() => true),
  }
  submissions = []
  window.localStorage.clear()
  // 启动页用 loadSavedServer() 取地址，默认值是真机服务器；测试固定成 x.test
  window.localStorage.setItem('vibe-study.server-url', SERVER)
  if (dismissed) window.localStorage.setItem('vibe-study.dismissed-update', dismissed)
  document.body.innerHTML = bodyHtml
  window.VibeAppUpdate = bridge
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(published) })))
  HTMLFormElement.prototype.submit = function onSubmit() { submissions.push(this.action) }
  new Function(bootSrc)()
  new Function(inlineSrc)()
  return bridge
}

/** 点「进入」→ 等 checkAppUpdate 的 promise 落地。 */
async function tapEnter() {
  document.getElementById('enterBtn').click()
  await vi.waitFor(() => {
    expect(document.getElementById('otaHint').style.display).toBe('block')
  })
}

beforeEach(() => {
  vi.useRealTimers()
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete window.VibeAppUpdate
  document.body.innerHTML = ''
})

describe('可选更新：只提示，不拦人', () => {
  it('发现新版显示「现在更新 / 以后再说」两个按钮，且不自动下载', async () => {
    const bridge = mount()
    await tapEnter()
    expect(document.getElementById('otaActions').style.display).toBe('block')
    expect(document.getElementById('otaHint').textContent).toContain('1.0.16')
    expect(bridge.downloadAndInstall).not.toHaveBeenCalled()
    // 尚未进入应用：等待用户选择
    expect(submissions).toEqual([])
  })

  it('点「现在更新」才下载，提示转为下载中', async () => {
    const bridge = mount()
    await tapEnter()
    document.getElementById('otaInstallBtn').click()
    expect(bridge.downloadAndInstall).toHaveBeenCalledTimes(1)
    expect(bridge.downloadAndInstall.mock.calls[0][0]).toBe(`${SERVER}/app/vibe-study-1.0.16-release.apk`)
    expect(document.getElementById('otaHint').textContent).toContain('下载中')
    expect(document.getElementById('otaActions').style.display).toBe('none')
  })

  it('点「以后再说」：记住该版本并进入应用', async () => {
    mount()
    await tapEnter()
    document.getElementById('otaLaterBtn').click()
    expect(window.localStorage.getItem('vibe-study.dismissed-update')).toBe('1.0.16')
    expect(submissions).toHaveLength(1)
  })

  it('同一版本已点过「以后再说」：直接进入，不再弹提示', async () => {
    mount({ dismissed: '1.0.16' })
    document.getElementById('enterBtn').click()
    await vi.waitFor(() => {
      expect(submissions).toHaveLength(1)
    })
    expect(document.getElementById('otaActions').style.display).toBe('none')
  })

  it('缺安装权限时点「现在更新」：引导去开权限，不下载', async () => {
    const bridge = mount({ permission: false })
    await tapEnter()
    document.getElementById('otaInstallBtn').click()
    expect(bridge.openUpdatePermissionSettings).toHaveBeenCalledTimes(1)
    expect(bridge.downloadAndInstall).not.toHaveBeenCalled()
  })
})

describe('强制更新：跨过底线仍然拦下', () => {
  it('当前版本低于底线：不弹可选按钮，直接进入下载流程', async () => {
    const bridge = mount({ versionCode: 10014000, published: MANDATORY })
    await tapEnter()
    expect(bridge.downloadAndInstall).toHaveBeenCalledTimes(1)
    expect(document.getElementById('otaActions').style.display).toBe('none')
    expect(document.getElementById('otaHint').textContent).toContain('下载中')
    expect(submissions).toEqual([])
  })
})

describe('可选更新放着不管', () => {
  it('5 秒后自动进入应用，下次启动再提示', async () => {
    vi.useFakeTimers()
    mount()
    // 倒计时 2 秒走完 → 检查更新 → 出现可选提示
    vi.advanceTimersByTime(2000)
    await vi.waitFor(() => {
      expect(document.getElementById('otaActions').style.display).toBe('block')
    })
    vi.advanceTimersByTime(5000)
    expect(submissions).toHaveLength(1)
    // 没有点过「以后再说」，所以下次启动仍会提示
    expect(window.localStorage.getItem('vibe-study.dismissed-update')).toBeNull()
  })
})

describe('下载进度条（真机反馈：不知道是不是在下载）', () => {
  /** 点「现在更新」把界面推进到下载中。 */
  async function startDownload() {
    mount()
    await tapEnter()
    document.getElementById('otaInstallBtn').click()
  }

  function progress() { return document.getElementById('otaProgress') }

  it('点「现在更新」立刻出现进度条，总量未知时是不确定态', async () => {
    await startDownload()
    expect(progress().style.display).toBe('block')
    expect(document.getElementById('otaProgressBar').className).toContain('indeterminate')
    expect(document.getElementById('otaProgressText').textContent).toContain('准备下载')
  })

  it('收到原生进度事件：显示百分比，进度条按比例填充', async () => {
    await startDownload()
    document.dispatchEvent(new CustomEvent('vibe-ota-progress', {
      detail: { received: 1000, total: 4000 },
    }))
    expect(document.getElementById('otaProgressText').textContent).toContain('25%')
    expect(document.getElementById('otaProgressBar').style.width).toBe('25%')
    expect(document.getElementById('otaProgressBar').className).not.toContain('indeterminate')
  })

  it('下完（received=total）：100% 并提示正在拉起安装界面', async () => {
    await startDownload()
    document.dispatchEvent(new CustomEvent('vibe-ota-progress', {
      detail: { received: 4000, total: 4000 },
    }))
    expect(document.getElementById('otaProgressText').textContent).toContain('100%')
    expect(document.getElementById('otaProgressText').textContent).toContain('安装')
  })

  it('没有内容长度时退化成已下载量，不显示假百分比', async () => {
    await startDownload()
    document.dispatchEvent(new CustomEvent('vibe-ota-progress', {
      detail: { received: 1048576, total: -1 },
    }))
    expect(document.getElementById('otaProgressText').textContent).toContain('已下载')
    expect(document.getElementById('otaProgressBar').className).toContain('indeterminate')
  })

  it('下载中途退回进入区：进度条不残留', async () => {
    await startDownload()
    expect(progress().style.display).toBe('block')
    document.getElementById('editBtn').click()
    document.getElementById('cancelBtn').click()
    expect(progress().style.display).toBe('none')
  })
  it('下载失败：进度条收起，换成失败提示', async () => {
    await startDownload()
    document.dispatchEvent(new CustomEvent('vibe-ota-progress', {
      detail: { received: 1000, total: 4000 },
    }))
    document.dispatchEvent(new CustomEvent('vibe-ota-failed', { detail: { reason: 'timeout' } }))
    expect(progress().style.display).toBe('none')
    expect(document.getElementById('otaHint').textContent).toContain('失败')
  })
})
