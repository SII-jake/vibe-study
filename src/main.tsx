import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/App'
import { installSelectionGuard } from './ui/selection-guard'
import { cleanupStaleServiceWorkers } from './sw-cleanup'
import './styles.css'

const container = document.getElementById('root')
if (!container) throw new Error('缺少根节点')

// Android 壳：把「焦点是否在可编辑元素」同步给原生，正文区屏蔽系统选择菜单
installSelectionGuard()

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js')
  })
}

// dev 模式：清掉之前在生产构建注册的 SW。
// 旧 worker 的 cache-first 拦截与 HTTP 缓存不同，Disable cache 拦不住：
// 它会把旧的 /src/*.tsx 一直喂给浏览器，新代码到不了页面。
if (!import.meta.env.PROD) {
  void cleanupStaleServiceWorkers()
}
