import styles from './AskActionBar.module.css'

/** 操作条自身高度的估计值（padding + 按钮行高），锚定上移按它取 */
const BAR_HEIGHT = 48
/** 两枚按钮合计宽度的保守估计（108px 按钮 ×2 + gap + padding），视口 clamp 用 */
const BAR_HALF_WIDTH = 96
/** 与视口左右边缘保留的间隙 */
const EDGE_GAP = 8

/**
 * 选择后操作条（移动端实测改造二）：
 * - 位置锚定选区：浮在所选文本上方居中（选区矩形由外层按 getBoundingClientRect 给）；
 *   贴顶放不下时改放选区下方。不再是"钉死在输入框上方"（用户实测反馈不对）。
 * - 与 selectionchange 的触发时机配合：选择拖动中绝不渲染（外层控制显隐），
 *   否则遮罩会接管拖选手柄，永远无法扩选（移动端实测过该缺陷）。
 */
export function AskActionBar({
  anchorText,
  rect,
  onAsk,
  onCopied,
}: {
  anchorText: string
  rect: DOMRect
  onAsk: () => void
  onCopied: () => void
}) {
  const copy = () => {
    navigator.clipboard?.writeText(anchorText).then(onCopied, onCopied)
  }
  // 上方放时底边与选区顶对齐；放不下（贴顶）改放选区下方留 8px 缝
  const fitsAbove = rect.top - BAR_HEIGHT >= EDGE_GAP
  const top = fitsAbove ? rect.top - BAR_HEIGHT : rect.bottom + EDGE_GAP
  // 中心点 clamp 时给条身留半宽，否则贴边一侧被视口裁切、两枚按钮压缩成一坨（真实手机反馈）
  const left = Math.min(
    Math.max(rect.left + rect.width / 2, EDGE_GAP + BAR_HALF_WIDTH),
    window.innerWidth - EDGE_GAP - BAR_HALF_WIDTH,
  )
  return (
    <div
      className={styles.bar}
      data-ask-bar
      style={{ top: `${top}px`, left: `${left}px` }}
    >
      <button type="button" className={styles.action} onClick={onAsk}>
        追问
      </button>
      <button type="button" className={styles.action} onClick={copy}>
        复制
      </button>
    </div>
  )
}
