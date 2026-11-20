// 启动页地址归一化逻辑测试（jsdom 环境，boot.js 作为页面脚本加载）
// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it } from 'vitest'

const bootSrc = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../android-shell/boot.js'),
  'utf8',
)

beforeEach(() => {
  window.localStorage.clear()
  // boot.js 挂在 window 上，每次重新执行保证状态隔离
  new Function(bootSrc)()
})

describe('normalizeServerUrl', () => {
  it('完整 https 地址原样返回并去掉尾斜杠', () => {
    expect(window.VibeBoot.normalizeServerUrl('https://study.sii.edu.cn/')).toBe(
      'https://study.sii.edu.cn',
    )
  })

  it('裸域名补 http 协议', () => {
    expect(window.VibeBoot.normalizeServerUrl('study.local')).toBe('http://study.local')
  })

  it('IP 加端口补 http 协议', () => {
    expect(window.VibeBoot.normalizeServerUrl('10.252.158.96:8787')).toBe(
      'http://10.252.158.96:8787',
    )
  })

  it('带路径时只保留源地址', () => {
    expect(window.VibeBoot.normalizeServerUrl('https://study.sii.edu.cn/n/abc')).toBe(
      'https://study.sii.edu.cn',
    )
  })

  it('空输入与非 http 协议返回 null', () => {
    expect(window.VibeBoot.normalizeServerUrl('')).toBeNull()
    expect(window.VibeBoot.normalizeServerUrl('   ')).toBeNull()
    expect(window.VibeBoot.normalizeServerUrl('ftp://x.com')).toBeNull()
    expect(window.VibeBoot.normalizeServerUrl('javascript:alert(1)')).toBeNull()
  })
})

describe('loadSavedServer / saveServer', () => {
  it('未保存时回落到默认地址', () => {
      expect(window.VibeBoot.loadSavedServer()).toBe('https://8.153.198.42:18003')
  })

  it('保存后再读取返回保存值', () => {
    window.VibeBoot.saveServer('http://10.0.0.1:8787')
    expect(window.VibeBoot.loadSavedServer()).toBe('http://10.0.0.1:8787')
  })

  it('保存的值损坏时回落到默认地址', () => {
    window.localStorage.setItem('vibe-study.server-url', '::::')
      expect(window.VibeBoot.loadSavedServer()).toBe('https://8.153.198.42:18003')
  })
})

describe('访问口令', () => {
  it('未设置时回落到硬编码默认口令', () => {
    expect(window.VibeBoot.loadPassword()).toBe(window.VibeBoot.DEFAULT_PASSWORD)
    expect(window.VibeBoot.DEFAULT_PASSWORD.length).toBeGreaterThan(0)
  })

  it('保存自定义口令后读取返回保存值', () => {
    window.VibeBoot.savePassword('my-own-pass')
    expect(window.VibeBoot.loadPassword()).toBe('my-own-pass')
  })

  it('保存空串等于清除，回落到默认口令', () => {
    window.VibeBoot.savePassword('my-own-pass')
    window.VibeBoot.savePassword('')
    expect(window.VibeBoot.loadPassword()).toBe(window.VibeBoot.DEFAULT_PASSWORD)
  })
})

describe('enterApp 自动登录', () => {
  it('以表单 POST 向服务器 /api/auth 提交口令，成功后落进应用', () => {
    const oldSubmit = window.HTMLFormElement.prototype.submit
    let submitted = null
    window.HTMLFormElement.prototype.submit = function () {
      submitted = this
    }
    try {
      window.VibeBoot.savePassword('saved-pass')
      window.VibeBoot.enterApp('https://8.153.198.42:18003')
      expect(submitted).not.toBeNull()
      expect(submitted.method.toLowerCase()).toBe('post')
      expect(submitted.action).toBe('https://8.153.198.42:18003/api/auth')
      const field = submitted.querySelector('input[name="password"]')
      expect(field).not.toBeNull()
      expect(field.value).toBe('saved-pass')
    } finally {
      window.HTMLFormElement.prototype.submit = oldSubmit
    }
  })

  it('未改过口令时提交默认口令', () => {
    const oldSubmit = window.HTMLFormElement.prototype.submit
    let submitted = null
    window.HTMLFormElement.prototype.submit = function () {
      submitted = this
    }
    try {
      window.VibeBoot.enterApp('https://8.153.198.42:18003')
      expect(submitted.querySelector('input[name="password"]').value).toBe(
        window.VibeBoot.DEFAULT_PASSWORD,
      )
      expect(submitted.action).toBe('https://8.153.198.42:18003/api/auth')
    } finally {
      window.HTMLFormElement.prototype.submit = oldSubmit
    }
  })
})

// 服务器地址下拉候选（实测需求，二次迭代）：datalist 在 Android WebView 需键入才给
// 建议、交互不是"点开列全量候选"（用户实测不到下拉），改为自绘可点列表——
// 候选含默认域名与新 IP，点击即回填；手动输入能力保留（input 本身仍在）。
describe('启动页服务器地址预设下拉', () => {
  const html = readFileSync('android-shell/index.html', 'utf8')

  it('服务器预设含默认域名与新 IP（不自创同义改写，与 normalize 判据一致）', () => {
    expect(html).toContain('https://study.sii.edu.cn')
    expect(html).toContain('https://8.153.198.42:18003')
  })

  it('预设以可点选项形态渲染（button + data-server-value，不再依赖 datalist）', () => {
    expect(html).toMatch(/<button[^>]*data-server-value="https:\/\/study\.sii\.edu\.cn"/)
    expect(html).toMatch(/<button[^>]*data-server-value="https:\/\/8\.153\.198\.42:18003"/)
  })
})

// publish-apk.sh 必须先 cap sync：android-shell 资产不进 git tracked 的 assets（gitignored），
// 不同步就打出来的 APK 还是上次的旧启动页（手机上 datalist 因此拿不到，真实踩坑）。
describe('publish-apk.sh 的壳内资产同步守护', () => {
  const script = readFileSync('scripts/publish-apk.sh', 'utf8')
  it('构建前必须存在 npx cap sync android 步骤', () => {
    expect(script).toMatch(/npx cap sync android/)
  })
})

// 默认口令强度守卫（用户要求）：硬编进壳的兜底口令必须是复杂口令，
// 两位数兜底进公网等于裸奔；此红线钉死防止将来改回弱口令。
describe('DEFAULT_PASSWORD 强度', () => {
  it('默认口令长度不低于 16 位', () => {
    const boot = readFileSync('android-shell/boot.js', 'utf8')
    const pwd = boot.match(/DEFAULT_PASSWORD = '([^']+)'/)?.[1] ?? ''
    expect(pwd.length).toBeGreaterThanOrEqual(16)
  })
})
