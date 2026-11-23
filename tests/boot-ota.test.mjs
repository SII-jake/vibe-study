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

  // 2026-11-23 改口径：发现新版不再一律强制下载，只有跨过服务端给定的强制底线
  // （minVersionCode）才拦人。这两条原本断言"有新版就下载"，改为强制路径的权限分支。
  it('跨过强制底线但无安装权限：引导去开权限，不直接下载', async () => {
    const bridge = fakeBridge({ versionCode: 1, permission: false })
    const boot = loadBoot({
      bridge,
      fetchImpl: vi.fn(() => okResponse({ ...okUpdate, minVersionCode: 10002000 })),
    })
    const result = await boot.checkAppUpdate('https://x.test')
    expect(result.status).toBe('need-permission')
    expect(result.versionName).toBe('1.2.0')
    expect(bridge.openUpdatePermissionSettings).toHaveBeenCalledTimes(1)
    expect(bridge.downloadAndInstall).not.toHaveBeenCalled()
  })

  it('跨过强制底线且有权限：下载并拉起安装，把 URL 与 sha256 交给原生', async () => {
    const bridge = fakeBridge({ versionCode: 1 })
    const fetchImpl = vi.fn(() => okResponse({ ...okUpdate, minVersionCode: 10002000 }))
    const boot = loadBoot({ bridge, fetchImpl })
    const result = await boot.checkAppUpdate('https://x.test')
    expect(result.status).toBe('downloading')
    expect(result.mandatory).toBe(true)
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

// 强制/可选更新分流：minVersionCode 是服务端给出的强制底线。
// 当前版本低于底线 → 必须装完才能进应用；高于底线只是可选更新，用户有空再装。
describe('checkAppUpdate：强制更新底线', () => {
  // 版本号取真实量级（1.0.15 → 10015000），与 build.gradle 的 versionCode 同算法。
  const remote = (minVersionCode) => ({ ...okUpdate, versionCode: 10017000, minVersionCode })

  it('底线未触及：optional，且不自动拉起下载', async () => {
    const bridge = fakeBridge({ versionCode: 10016000 })
    const boot = loadBoot({ bridge, fetchImpl: vi.fn(() => okResponse(remote(10015000))) })
    const result = await boot.checkAppUpdate('https://x.test')
    expect(result.status).toBe('optional')
    expect(result.mandatory).toBe(false)
    expect(result.versionName).toBe('1.2.0')
    expect(bridge.downloadAndInstall).not.toHaveBeenCalled()
  })

  it('当前版本低于底线：强制更新，直接下载并安装', async () => {
    const bridge = fakeBridge({ versionCode: 10014000 })
    const boot = loadBoot({ bridge, fetchImpl: vi.fn(() => okResponse(remote(10015000))) })
    const result = await boot.checkAppUpdate('https://x.test')
    expect(result.status).toBe('downloading')
    expect(result.mandatory).toBe(true)
    expect(bridge.downloadAndInstall).toHaveBeenCalledTimes(1)
  })

  it('当前版本恰等于底线：不强制（底线本身是兼容的）', async () => {
    const bridge = fakeBridge({ versionCode: 10015000 })
    const boot = loadBoot({ bridge, fetchImpl: vi.fn(() => okResponse(remote(10015000))) })
    expect((await boot.checkAppUpdate('https://x.test')).status).toBe('optional')
  })

  it('响应缺 minVersionCode：按可选处理，不拦人', async () => {
    const bridge = fakeBridge({ versionCode: 10014000 })
    // 服务端尚未带策略字段（老部署）：只比版本，升级一律可选
    const boot = loadBoot({
      bridge,
      fetchImpl: vi.fn(() => okResponse({ ...okUpdate, versionCode: 10017000 })),
    })
    expect((await boot.checkAppUpdate('https://x.test')).status).toBe('optional')
  })

  it('已是最新版本时，无论底线如何都不提示更新', async () => {
    const bridge = fakeBridge({ versionCode: 10020000 })
    const boot = loadBoot({ bridge, fetchImpl: vi.fn(() => okResponse(remote(10015000))) })
    expect((await boot.checkAppUpdate('https://x.test')).status).toBe('up-to-date')
  })
})

describe('installUpdate：用户点「现在更新」时复用同一条下载链路', () => {
  const update = { versionName: '1.2.0', apkName: 'vibe-study-1.2.0-release.apk', sha256: 'aa'.repeat(32) }

  it('有权限：交给原生下载，URL 拼自 update.apkName', () => {
    const bridge = fakeBridge()
    const boot = loadBoot({ bridge, fetchImpl: vi.fn() })
    const result = boot.installUpdate('https://x.test', update)
    expect(result.status).toBe('downloading')
    expect(bridge.downloadAndInstall).toHaveBeenCalledWith(
      'https://x.test/app/vibe-study-1.2.0-release.apk',
      'aa'.repeat(32),
    )
  })

  it('无权限：引导去开权限，不下载', () => {
    const bridge = fakeBridge({ permission: false })
    const boot = loadBoot({ bridge, fetchImpl: vi.fn() })
    expect(boot.installUpdate('https://x.test', update).status).toBe('need-permission')
    expect(bridge.openUpdatePermissionSettings).toHaveBeenCalledTimes(1)
    expect(bridge.downloadAndInstall).not.toHaveBeenCalled()
  })

  it('原生拒绝：download-failed，启动页据此放行', () => {
    const bridge = fakeBridge()
    bridge.downloadAndInstall = vi.fn(() => false)
    const boot = loadBoot({ bridge, fetchImpl: vi.fn() })
    expect(boot.installUpdate('https://x.test', update).status).toBe('download-failed')
  })
})

// 「以后再说」记在该手机上：同一个可选版本不再每次启动都弹，出现更新的版本才再提示。
describe('可选更新的「以后再说」记忆', () => {
  const update = { versionCode: 3, versionName: '1.2.0', apkName: 'vibe-study-1.2.0-release.apk', sha256: 'aa'.repeat(32) }

  it('未点过「以后再说」：不视为已忽略', () => {
    const boot = loadBoot({ bridge: fakeBridge(), fetchImpl: vi.fn() })
    expect(boot.isUpdateDismissed('1.2.0')).toBe(false)
  })

  it('点过「以后再说」：同一版本视为已忽略', () => {
    const boot = loadBoot({ bridge: fakeBridge(), fetchImpl: vi.fn() })
    boot.dismissUpdate('1.2.0')
    expect(boot.isUpdateDismissed('1.2.0')).toBe(true)
    expect(boot.isUpdateDismissed('1.3.0')).toBe(false)
  })
})
