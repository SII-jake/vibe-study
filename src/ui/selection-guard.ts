/**
 * 文本选择守卫（Android 远程壳配套）：
 * 正文长按选择时，系统 ActionMode 菜单会与我们的「就这段提问」浮动按钮
 * 同时弹出（真实手机反馈）。Web 层没有 API 屏蔽系统菜单，由原生壳在
 * onActionModeStarted 时拦截；本模块只负责一件事——把
 * 「当前焦点是否在可编辑元素」实时同步给原生层：
 * - 正文/按钮等不可编辑区域：原生层浮现系统选择菜单时立即 finish；
 * - input/textarea/contenteditable：焦点在其上时放行（粘贴、全选菜单仍可用）。
 *
 * 原生桥：壳通过 addJavascriptInterface 注入 window.VibeSelectionGuard；
 * 浏览器环境没有该对象时静默跳过。
 */

declare global {
  interface Window {
    VibeSelectionGuard?: { setEditableFocused(focused: boolean): void }
  }
}

/** 判断焦点元素是否可编辑（自身或祖先 contenteditable 也算）。 */
export function isEditableElement(el: Element | null): boolean {
  if (!el) return false
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
    return !el.disabled
  }
  return el.closest('[contenteditable="true"]') !== null
}

/**
 * 当前是否「可编辑上下文」：判定优先级选区 > 焦点。
 * 输入框持焦后再长按正文，长按点已不在输入框里——此时若只按焦点放行，
 * 系统菜单会在正文区重新漏出；以选区所在元素为准，覆盖焦点口径。
 */
function editableContextNow(): boolean {
  const selection = window.getSelection()
  if (selection && !selection.isCollapsed && selection.rangeCount > 0) {
    const anchor = selection.anchorNode
    if (anchor) {
      const el = anchor.nodeType === Node.ELEMENT_NODE ? (anchor as Element) : anchor.parentElement
      return isEditableElement(el)
    }
  }
  return isEditableElement(document.activeElement)
}

/** 把当前可编辑上下文推给原生层；桥不存在时静默。 */
function notifyNative() {
  const bridge = window.VibeSelectionGuard
  if (!bridge) return
  bridge.setEditableFocused(editableContextNow())
}

/**
 * 安装状态同步：focusin 立即同步；focusout 延后一拍——
 * focusout 触发时新焦点尚未落地，须等焦点落定后再读 activeElement。
 * selectionchange 同步覆盖选区变化（长按点移动、选区折叠回焦点口径）。
 */
export function installSelectionGuard(): void {
  document.addEventListener('focusin', notifyNative, true)
  document.addEventListener(
    'focusout',
    () => {
      setTimeout(notifyNative, 0)
    },
    true,
  )
  document.addEventListener('selectionchange', notifyNative)
}
