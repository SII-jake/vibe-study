/** 启动页逻辑：纯浏览器实现，不依赖 Capacitor API，file:// 下即可运行（也便于测试）。 */

const VIBE_BOOT_STORAGE_KEY = 'vibe-study.server-url'
const DEFAULT_SERVER = 'https://study.sii.edu.cn'

/** 把用户输入归一成服务器源地址；无法识别的输入返回 null。 */
function normalizeServerUrl(input) {
  const trimmed = (input ?? '').trim().replace(/\/+$/, '')
  if (trimmed === '') return null
  // 只认两种形态：带 http(s) 协议的完整地址，或不含任何协议的裸主机[：端口]。
  // 其他协议与格式（ftp://、javascript:、带 ? 或 @ 的奇怪输入）一律视为不可识别，
  // 而不是猜测补全后放行。
  const withScheme = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : trimmed.includes('://') || trimmed.includes('?') || trimmed.includes('@')
      ? null
      : `http://${trimmed}`
  if (withScheme === null) return null
  let url
  try {
    url = new URL(withScheme)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  if (url.hostname === '') return null
  return url.origin
}

function loadSavedServer() {
  const saved = normalizeServerUrl(window.localStorage.getItem(VIBE_BOOT_STORAGE_KEY) ?? '')
  return saved ?? DEFAULT_SERVER
}

function saveServer(server) {
  window.localStorage.setItem(VIBE_BOOT_STORAGE_KEY, server)
}

/**
 * 壳内检查更新：问服务器发布了哪个 APK，与原生桥给的当前版本号比对。
 * 状态机：no-bridge（纯浏览器） / skipped（服务器没发布或不可达，静默放行）
 * / up-to-date / need-permission（有新版、缺安装权限） / downloading（已拉起下载）。
 * 壳只在 downloading 与 need-permission 两态拦下进入应用，其余一律放行。
 */
async function checkAppUpdate(server) {
  const bridge = window.VibeAppUpdate
  if (!bridge || typeof bridge.getVersionCode !== 'function') return { status: 'no-bridge' }

  let published
  try {
    const response = await fetch(`${server}/api/app-version`)
    if (!response.ok) return { status: 'skipped', reason: `http-${response.status}` }
    published = await response.json()
  } catch (error) {
    return { status: 'skipped', reason: error?.message ?? 'offline' }
  }

  const remoteCode = Number(published?.versionCode)
  if (!Number.isInteger(remoteCode) || remoteCode < 1) {
    return { status: 'up-to-date', current: bridge.getVersionCode() }
  }

  const current = bridge.getVersionCode()
  if (remoteCode <= current) return { status: 'up-to-date', current }

  const versionName = published.versionName ?? ''
  if (typeof bridge.hasUpdatePermission === 'function' && !bridge.hasUpdatePermission()) {
    // 权限引导：打开本应用「安装未知来源」系统设置；用户开完回来自动再检查
    bridge.openUpdatePermissionSettings()
    return { status: 'need-permission', versionName }
  }

  const url = `${server}/app/${published.apkName}`
  bridge.downloadAndInstall(url, published.sha256 ?? '')
  return { status: 'downloading', versionName }
}

window.VibeBoot = {
  DEFAULT_SERVER,
  normalizeServerUrl,
  loadSavedServer,
  saveServer,
  checkAppUpdate,
  enterApp(server) {
    window.location.replace(server)
  },
}
