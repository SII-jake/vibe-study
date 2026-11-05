// 设置页「检查更新」：复用启动页 checkAppUpdate 的状态机，但面向已打开的应用——
// 与启动页差异在两点：落地页源即服务器（URL 直接用 location.origin），
// 且「本地当前版本」给用户看的是 versionName（versionCode 只用于比较）。
// 无原生桥时按钮直接隐藏，该状态在此只允许出现在异常路径。
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  checkInstalledAppUpdate,
  currentVersionLabel,
  hasUpdateBridge,
} from '../src/ui/app-update-check'

interface FakeBridgeOptions {
  versionName?: string
  versionCode?: number
  permission?: boolean
}

function fakeBridge({ versionName = '1.0.0', versionCode = 1000000, permission = true }: FakeBridgeOptions = {}) {
  return {
    getVersionName: vi.fn(() => versionName),
    getVersionCode: vi.fn(() => versionCode),
    hasUpdatePermission: vi.fn(() => permission),
    openUpdatePermissionSettings: vi.fn(),
    downloadAndInstall: vi.fn(() => true),
  }
}

const published = {
  versionName: '1.1.0',
  versionCode: 1001000,
  apkName: 'vibe-study-1.1.0-release.apk',
  sha256: 'ab'.repeat(32),
}

const okResponse = (payload: unknown) =>
  Promise.resolve({ ok: true, json: () => Promise.resolve(payload) } as Response)
const notFound = () => Promise.resolve({ ok: false, status: 404 } as Response)

beforeEach(() => {
  window.localStorage.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete (window as { VibeAppUpdate?: unknown }).VibeAppUpdate
})

describe('hasUpdateBridge', () => {
  it('无原生桥（纯浏览器）返回空', () => {
    expect(hasUpdateBridge()).toBe(false)
  })

  it('桥存在且带必需方法时返回真', () => {
    ;(window as { VibeAppUpdate?: unknown }).VibeAppUpdate = fakeBridge()
    expect(hasUpdateBridge()).toBe(true)
  })
})

describe('currentVersionLabel', () => {
  it('优先展示 versionName，缺方法时退化到 versionCode', () => {
    const bridge = fakeBridge({ versionName: '1.0.0', versionCode: 1000000 })
    ;(window as { VibeAppUpdate?: unknown }).VibeAppUpdate = bridge
    expect(currentVersionLabel()).toBe('1.0.0')
    const noName = { ...bridge, getVersionName: undefined }
    ;(window as { VibeAppUpdate?: unknown }).VibeAppUpdate = noName
    expect(currentVersionLabel()).toBe('build 1000000')
  })
})

describe('checkInstalledAppUpdate', () => {
  it('请求地址直接用落地页源（/api/app-version 同源），不拼启动页保存的服务器', async () => {
    ;(window as { VibeAppUpdate?: unknown }).VibeAppUpdate = fakeBridge()
    const fetchImpl = vi.fn(() => okResponse(published))
    vi.stubGlobal('fetch', fetchImpl)
    await checkInstalledAppUpdate()
    expect(fetchImpl).toHaveBeenCalledWith(`${window.location.origin}/api/app-version`)
  })

  it('服务器尚未发布 APK（404）：no-update，可分辨于「已是最新」', async () => {
    ;(window as { VibeAppUpdate?: unknown }).VibeAppUpdate = fakeBridge()
    vi.stubGlobal('fetch', vi.fn(notFound))
    await expect(checkInstalledAppUpdate()).resolves.toEqual({ kind: 'no-update' })
  })

  it('服务器不可达：返回失败原因而不是静默', async () => {
    ;(window as { VibeAppUpdate?: unknown }).VibeAppUpdate = fakeBridge()
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
    const result = await checkInstalledAppUpdate()
    expect(result).toEqual({ kind: 'failed', reason: 'offline' })
  })

  it('远端不高于本地：up-to-date，不触发下载', async () => {
    const bridge = fakeBridge({ versionCode: 1001000 })
    ;(window as { VibeAppUpdate?: unknown }).VibeAppUpdate = bridge
    vi.stubGlobal('fetch', vi.fn(() => okResponse(published)))
    await expect(checkInstalledAppUpdate()).resolves.toEqual({
      kind: 'up-to-date',
      current: '1.0.0',
    })
    expect(bridge.downloadAndInstall).not.toHaveBeenCalled()
  })

  it('远端 versionCode 非法：按 up-to-date 放行（防误更）', async () => {
    ;(window as { VibeAppUpdate?: unknown }).VibeAppUpdate = fakeBridge()
    vi.stubGlobal('fetch', vi.fn(() => okResponse({ versionName: '???' })))
    expect((await checkInstalledAppUpdate()).kind).toBe('up-to-date')
  })

  it('有新版但缺安装权限：只引导开权限，不下载', async () => {
    const bridge = fakeBridge({ versionCode: 1, permission: false })
    ;(window as { VibeAppUpdate?: unknown }).VibeAppUpdate = bridge
    vi.stubGlobal('fetch', vi.fn(() => okResponse(published)))
    const result = await checkInstalledAppUpdate()
    expect(result).toEqual({ kind: 'need-permission', versionName: '1.1.0' })
    expect(bridge.openUpdatePermissionSettings).toHaveBeenCalledTimes(1)
    expect(bridge.downloadAndInstall).not.toHaveBeenCalled()
  })

  it('有新版且有权限：拉起下载，URL 取源站 /app/<apkName>', async () => {
    const bridge = fakeBridge({ versionCode: 1 })
    ;(window as { VibeAppUpdate?: unknown }).VibeAppUpdate = bridge
    vi.stubGlobal('fetch', vi.fn(() => okResponse(published)))
    const result = await checkInstalledAppUpdate()
    expect(result).toEqual({ kind: 'downloading', versionName: '1.1.0' })
    expect(bridge.downloadAndInstall).toHaveBeenCalledWith(
      `${window.location.origin}/app/${published.apkName}`,
      published.sha256,
    )
  })

  it('下载提交失败（原生返回 false）：报失败而非假提示下载中', async () => {
    const bridge = fakeBridge({ versionCode: 1 })
    bridge.downloadAndInstall.mockReturnValue(false)
    ;(window as { VibeAppUpdate?: unknown }).VibeAppUpdate = bridge
    vi.stubGlobal('fetch', vi.fn(() => okResponse(published)))
    expect((await checkInstalledAppUpdate()).kind).toBe('failed')
  })
})
