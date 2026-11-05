/** 启动页逻辑：纯浏览器实现，不依赖 Capacitor API，file:// 下即可运行（也便于测试）。 */

const VIBE_BOOT_STORAGE_KEY = 'vibe-study.server-url'
const VIBE_BOOT_PASSWORD_KEY = 'vibe-study.password'
const DEFAULT_SERVER = 'http://210.45.88.175:8787'
/** 口令硬编码一份默认：自用单机库 default 即正确值；改服务器口令后在启动页里改本地值即可。 */
const DEFAULT_PASSWORD = 'vi'

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
 * 启动页返回键判定（纯函数，供 shell 脚本与测试共用）：
 * - 编辑区打开：回进入区（cancel-edit）。
 * - 进入区倒计时进行中：取消自动进入，留在当前页（cancel-countdown）。
 * - 进入区且无倒计时（用户已主动取消过）：退出应用（exit）。
 */
function resolveBootBack(state) {
  if (state.editing) return 'cancel-edit'
  if (state.autoCounting) return 'cancel-countdown'
  return 'exit'
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
  DEFAULT_PASSWORD,
  normalizeServerUrl,
  loadSavedServer,
  saveServer,
  resolveBootBack,
  checkAppUpdate,

  enterApp(server) {
    /**
     * 登录换 Cookie 走整页 form POST 导航，不走 fetch：
     * 启动页在壳里是 file:// 源，fetch 到 https/http 是跨源且带第三方 Cookie，
     * 移动端 WebView 多次证明不可靠（OTA 已踩过同样的坑）。导航不受 CORS 限制，
     * 服务端 303 回种 Cookie 后落到 /，绕开整个跨源问题域。
     */
    const form = document.createElement('form')
    form.method = 'post'
    form.action = `${server}/api/auth`
    form.style.display = 'none'

    const field = document.createElement('input')
    field.type = 'hidden'
    field.name = 'password'
    field.value = loadPassword()
    form.appendChild(field)

    document.body.appendChild(form)
    form.submit()
  },
}
