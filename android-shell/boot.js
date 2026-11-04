/** 启动页逻辑：纯浏览器实现，不依赖 Capacitor API，file:// 下即可运行（也便于测试）。 */

const VIBE_BOOT_STORAGE_KEY = 'vibe-study.server-url'
const VIBE_BOOT_PASSWORD_KEY = 'vibe-study.password'
const DEFAULT_SERVER = 'https://study.sii.edu.cn'
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

function loadPassword() {
  const saved = (window.localStorage.getItem(VIBE_BOOT_PASSWORD_KEY) ?? '').trim()
  return saved === '' ? DEFAULT_PASSWORD : saved
}

/**
 * 保存本地口令；传空串/空白视为"恢复默认"，方便改乱后一键回去。
 */
function savePassword(password) {
  const trimmed = (password ?? '').trim()
  if (trimmed === '') window.localStorage.removeItem(VIBE_BOOT_PASSWORD_KEY)
  else window.localStorage.setItem(VIBE_BOOT_PASSWORD_KEY, trimmed)
}

window.VibeBoot = {
  DEFAULT_SERVER,
  DEFAULT_PASSWORD,
  normalizeServerUrl,
  loadSavedServer,
  saveServer,
  loadPassword,
  savePassword,
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
