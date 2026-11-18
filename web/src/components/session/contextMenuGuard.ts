/**
 * 系统选择菜单抑制（修复"一闪而过"）：
 *
 * Android WebView 长按触发系统 ActionMode 经由 contextmenu 事件通道；
 * 原生壳的 onActionModeStarted 拦截能"取消"菜单，但菜单已启动过一次
 * （壳 finish 后还会有系统粘贴菜单原生回退）——页面上呈现为闪一下。
 *
 * 正解是 contextmenu 的 preventDefault：系统菜单根本不启动。
 * 只在回答正文（data-ask-text，我们自己的选区交互区）内抑制——
 * 输入框/其他区域放行，系统粘贴/全选这些菜单要保留。
 * 日记/授权口径见 AGENTS.md 与 MainActivity#SelectionGuardBridge 的
 * 协同背景（该桥从此回归可逆旁路备份，页面侧主忙）。
 */
export function shouldSuppressContextMenu(target: Element | null): boolean {
  if (!target) return false
  return target.closest('[data-ask-text]') !== null
}

/** 安装守卫：只在回答正文的 contextmenu 上 preventDefault。返回拆除函数。 */
export function installContextMenuGuard() {
  const handler = (e: Event) => {
    if (e.cancelable && shouldSuppressContextMenu(e.target instanceof Element ? e.target : null)) {
      e.preventDefault()
    }
  }
  document.addEventListener('contextmenu', handler)
  return () => document.removeEventListener('contextmenu', handler)
}
