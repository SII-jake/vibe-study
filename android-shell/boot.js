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

window.VibeBoot = {
  DEFAULT_SERVER,
  normalizeServerUrl,
  loadSavedServer,
  saveServer,
  enterApp(server) {
    window.location.replace(server)
  },
}
