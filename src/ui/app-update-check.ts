/**
 * 设置页「检查更新」模块。
 *
 * 与启动页 android-shell/boot.js 的 checkAppUpdate 是同一台状态机，
 * 差异只在两点口径：
 * - 落地页源即服务器：已进应用后请求同源（location.origin）拿 /api/app-version，
 *   不再读启动页 localStorage 里保存的服务器地址；
 * - 用户手动触发：任何非「放行」的结果都要变成可见文案，不能静默。
 */

export interface AppUpdateBridge {
  getVersionName?(): string
  getVersionCode(): number
  hasUpdatePermission(): boolean
  openUpdatePermissionSettings(): void
  downloadAndInstall(url: string, sha256: string): boolean
}

declare global {
  interface Window {
    VibeAppUpdate?: AppUpdateBridge
  }
}

export type AppUpdateResult =
  | { kind: 'failed'; reason: string }
  | { kind: 'no-update' }
  | { kind: 'up-to-date'; current: string }
  | { kind: 'need-permission'; versionName: string }
  | { kind: 'downloading'; versionName: string }

function bridge(): AppUpdateBridge | null {
  const candidate = window.VibeAppUpdate
  return candidate && typeof candidate.getVersionCode === 'function' ? candidate : null
}

/** 设置页是否展示更新入口：只有 Android 壳（原生桥在）才有手动更新。 */
export function hasUpdateBridge(): boolean {
  return bridge() !== null
}

/** 当前安装版本给用户看的标签：优先 versionName，老壳没有该方法时退到 code。 */
export function currentVersionLabel(): string {
  const active = bridge()
  if (!active) return ''
  if (typeof active.getVersionName === 'function') return active.getVersionName()
  return `build ${active.getVersionCode()}`
}

/** 从落地页源拉服务端发布信息并比对；任何失败都转成可展示的状态。 */
export async function checkInstalledAppUpdate(): Promise<AppUpdateResult> {
  const active = bridge()
  if (!active) return { kind: 'failed', reason: 'no-bridge' }

  const origin = window.location.origin
  let published: { versionName?: string; versionCode?: number; apkName?: string; sha256?: string }
  try {
    const response = await fetch(`${origin}/api/app-version`)
    if (response.status === 404) return { kind: 'no-update' }
    if (!response.ok) return { kind: 'failed', reason: `http-${response.status}` }
    published = (await response.json()) as typeof published
  } catch (error) {
    return { kind: 'failed', reason: error instanceof Error ? error.message : 'offline' }
  }

  const remoteCode = Number(published.versionCode)
  if (!Number.isInteger(remoteCode) || remoteCode < 1 || remoteCode <= active.getVersionCode()) {
    return { kind: 'up-to-date', current: currentVersionLabel() }
  }

  const versionName = published.versionName ?? ''
  if (!active.hasUpdatePermission()) {
    active.openUpdatePermissionSettings()
    return { kind: 'need-permission', versionName }
  }

  const accepted = active.downloadAndInstall(`${origin}/app/${published.apkName}`, published.sha256 ?? '')
  return accepted
    ? { kind: 'downloading', versionName }
    : { kind: 'failed', reason: 'download-rejected' }
}
