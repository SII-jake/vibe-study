import { createRoot } from 'react-dom/client'
import { App } from './app/App.js'
import { setupTheme } from './app/theme.js'
import { ensureKatex } from './services/markdown/katex.js'
import { installSelectionGuard } from './services/selectionGuard.js'
import './app/theme.css'
import './app/global.css'

ensureKatex()
setupTheme()
// Android 远程壳的系统选择菜单拦截需要页面回写可编辑焦点（壳侧桥
// MainActivity#SelectionGuardBridge 常驻，浏览器下静默）
installSelectionGuard()

createRoot(document.getElementById('root') as HTMLElement).render(<App />)
