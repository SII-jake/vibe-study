// 设置页「应用更新」区块：只在 Android 壳（VibeAppUpdate 桥在）出现。
// 真机反馈：自动检查静默放行的场景用户完全无感，手动入口要给出每种状态的可见文案。
// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsPage } from '../src/ui/SettingsPage'
import { UNKNOWN_HEALTH } from '../src/ai/health'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

const published = {
  versionName: '1.1.0',
  versionCode: 1001000,
  apkName: 'vibe-study-1.1.0-release.apk',
  sha256: 'ab'.repeat(32),
}

function fakeBridge({ versionCode = 1000000, permission = true } = {}) {
  return {
    getVersionName: () => '1.0.0',
    getVersionCode: () => versionCode,
    hasUpdatePermission: () => permission,
    openUpdatePermissionSettings: vi.fn(),
    downloadAndInstall: vi.fn(() => true),
  }
}

const okResponse = (payload: unknown) =>
  Promise.resolve({ ok: true, json: () => Promise.resolve(payload) } as Response)

async function renderPage() {
  await act(async () => {
    root.render(
      <SettingsPage health={UNKNOWN_HEALTH} onRefreshHealth={() => {}} onBack={() => {}} />,
    )
  })
}

// 按钮文案会随状态切换（检查更新/检查中…），按文案前缀匹配
const updateButton = () =>
  Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.startsWith('检查'))
const updateText = () => document.querySelector('.update-status')?.textContent ?? ''

beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
  delete (window as { VibeAppUpdate?: unknown }).VibeAppUpdate
})

describe('SettingsPage 应用更新区块', () => {
  it('无原生桥（浏览器）不渲染更新入口', async () => {
    await renderPage()
    expect(updateButton()).toBeUndefined()
    expect(container.textContent).not.toContain('应用更新')
  })

  it('壳内渲染当前版本，点击后展示「已是最新」', async () => {
    ;(window as { VibeAppUpdate?: unknown }).VibeAppUpdate = fakeBridge({ versionCode: 1001000 })
    vi.stubGlobal('fetch', vi.fn(() => okResponse(published)))
    await renderPage()
    // 双行改版后的文案：应用版本（壳）与服务端版本并列，「当前版本」不再使用
    expect(container.textContent).toContain('应用版本 1.0.0')
    await act(async () => {
      updateButton()?.click()
    })
    expect(updateText()).toContain('已是最新版本')
  })

  it('壳内双行展示：应用版本 + 服务端版本', async () => {
    ;(window as { VibeAppUpdate?: unknown }).VibeAppUpdate = fakeBridge({ versionCode: 1001000 })
    vi.stubGlobal(
      'fetch',
      vi.fn(() => okResponse({ ...published, serverVersion: '1.1.0.3' })),
    )
    await renderPage()
    expect(container.textContent).toContain('应用版本 1.0.0')
    // 服务端版本拉取完成后出现
    await act(async () => {
      await Promise.resolve()
    })
    expect(container.textContent).toContain('服务端版本 1.1.0.3')
  })

  it('无桥浏览器也展示服务端版本行', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => okResponse({ ...published, serverVersion: '1.1.0.5' })),
    )
    await renderPage()
    await act(async () => {
      await Promise.resolve()
    })
    expect(container.textContent).toContain('服务端版本 1.1.0.5')
    // 无桥时不出现应用版本/更新入口
    expect(container.textContent).not.toContain('应用版本')
  })

  it('服务器未发布 APK：提示未发布，不冒充已是最新', async () => {
    ;(window as { VibeAppUpdate?: unknown }).VibeAppUpdate = fakeBridge()
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, status: 404 } as Response)))
    await renderPage()
    await act(async () => {
      updateButton()?.click()
    })
    expect(updateText()).toContain('尚未发布安装包')
  })

  it('有新版：提示版本号与下载中，安装界面交给系统', async () => {
    const bridge = fakeBridge({ versionCode: 1 })
    ;(window as { VibeAppUpdate?: unknown }).VibeAppUpdate = bridge
    vi.stubGlobal('fetch', vi.fn(() => okResponse(published)))
    await renderPage()
    await act(async () => {
      updateButton()?.click()
    })
    expect(updateText()).toContain('1.1.0')
    expect(updateText()).toContain('下载中')
    expect(bridge.downloadAndInstall).toHaveBeenCalledOnce()
  })

  it('检查中禁止重复点击，防止并发下载', async () => {
    const bridge = fakeBridge({ versionCode: 1 })
    ;(window as { VibeAppUpdate?: unknown }).VibeAppUpdate = bridge
    let resolveFetch: ((value: Response) => void) | undefined
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { resolveFetch = resolve })))
    await renderPage()
    await act(async () => {
      updateButton()?.click()
    })
    expect(updateButton()?.disabled).toBe(true)
    await act(async () => {
      resolveFetch?.({ ok: true, json: () => Promise.resolve(published) } as Response)
    })
    expect(bridge.downloadAndInstall).toHaveBeenCalledOnce()
  })

  it('检查失败：展示原因，不留空白', async () => {
    ;(window as { VibeAppUpdate?: unknown }).VibeAppUpdate = fakeBridge()
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
    await renderPage()
    await act(async () => {
      updateButton()?.click()
    })
    expect(updateText()).toContain('offline')
  })
})
