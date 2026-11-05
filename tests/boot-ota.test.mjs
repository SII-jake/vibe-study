// 启动页 OTA：拿服务器上的 APK 版本与壳内版本比对，决定走进度还是直接应用。
// 桥可能不存在（纯浏览器 dev），服务器可能没有 APK——都要静默放行进入应用。
// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const bootSrc = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../android-shell/boot.js'),
  'utf8',
)

function loadBoot({ bridge, fetchImpl }) {
  window.localStorage.clear()
  window.VibeAppUpdate = bridge
  vi.stubGlobal('fetch', fetchImpl)
  new Function(bootSrc)()
  return window.VibeBoot
}

function fakeBridge({ versionCode = 1, permission = true } = {}) {
  return {
    getVersionCode: vi.fn(() => versionCode),
    hasUpdatePermission: vi.fn(() => permission),
    openUpdatePermissionSettings: vi.fn(),
    downloadAndInstall: vi.fn(() => true),
  }
}

const okUpdate = { versionCode: 3, versionName: '1.2.0', apkName: 'vibe-study-1.2.0-release.apk', sha256: 'aa'.repeat(32) }
const okResponse = (payload) => Promise.resolve({ ok: true, json: () => Promise.resolve(payload) })

afterEach(() => {
  vi.unstubAllGlobals()
  delete window.VibeAppUpdate
})

describe('checkAppUpdate', () => {
  it('无原生桥（纯浏览器）直接放行，不发起请求', async () => {
    const fetchImpl = vi.fn()
    const boot = loadBoot({ bridge: undefined, fetchImpl })
    await expect(boot.checkAppUpdate('https://x.test')).resolves.toEqual({ status: 'no-bridge' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('服务器未发布 APK（404）：放行进入应用', async () => {
    const bridge = fakeBridge()
    const boot = loadBoot({ bridge, fetchImpl: vi.fn(() => Promise.resolve({ ok: false, status: 404 })) })
    const result = await boot.checkAppUpdate('https://x.test')
    expect(result.status).toBe('skipped')
    expect(result.reason).toBe('http-404')
  })

  it('服务器不可达：放行进入应用', async () => {
    const bridge = fakeBridge()
    const boot = loadBoot({ bridge, fetchImpl: vi.fn(() => Promise.reject(new Error('offline'))) })
    expect((await boot.checkAppUpdate('https://x.test')).status).toBe('skipped')
  })

  it('远端版本不高于当前：up-to-date，不触发下载', async () => {
    const bridge = fakeBridge({ versionCode: 3 })
    const boot = loadBoot({ bridge, fetchImpl: vi.fn(() => okResponse({ ...okUpdate, versionCode: 3 })) })
    await expect(boot.checkAppUpdate('https://x.test')).resolves.toEqual({ status: 'up-to-date', current: 3 })
    expect(bridge.downloadAndInstall).not.toHaveBeenCalled()
  })

  it('有新版但无安装权限：引导去开权限，不直接下载', async () => {
    const bridge = fakeBridge({ versionCode: 1, permission: false })
    const boot = loadBoot({ bridge, fetchImpl: vi.fn(() => okResponse(okUpdate)) })
    const result = await boot.checkAppUpdate('https://x.test')
    expect(result.status).toBe('need-permission')
    expect(result.versionName).toBe('1.2.0')
    expect(bridge.openUpdatePermissionSettings).toHaveBeenCalledTimes(1)
    expect(bridge.downloadAndInstall).not.toHaveBeenCalled()
  })

  it('有新版且有权限：下载并拉起安装，把 URL 与 sha256 交给原生', async () => {
    const bridge = fakeBridge({ versionCode: 1 })
    const fetchImpl = vi.fn(() => okResponse(okUpdate))
    const boot = loadBoot({ bridge, fetchImpl })
    const result = await boot.checkAppUpdate('https://x.test')
    expect(result.status).toBe('downloading')
    expect(result.versionName).toBe('1.2.0')
    expect(bridge.downloadAndInstall).toHaveBeenCalledWith(
      'https://x.test/app/vibe-study-1.2.0-release.apk',
      'aa'.repeat(32),
    )
  })

  it('versionCode 缺字段/非整数：按 up-to-date 放行，不误更', async () => {
    const bridge = fakeBridge({ versionCode: 1 })
    const boot = loadBoot({ bridge, fetchImpl: vi.fn(() => okResponse({ versionName: '???' })) })
    expect((await boot.checkAppUpdate('https://x.test')).status).toBe('up-to-date')
  })
})
