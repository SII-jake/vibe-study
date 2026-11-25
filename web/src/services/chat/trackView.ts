/**
 * track 计算纯函数（decisions/2026-11-19：双端同一 lane 轨道）。
 * 语义源：备份分支 feature/chat-ui-tools 的 track-view.ts / track-stage.tsx。
 *
 * 对话链按层次从左到右铺成 lane 序列；视口只框住最后 N 格——
 * 桌面 LANES_IN_VIEW=2（中栏+右栏），手机 singlePane=1（每格铺满、钉末格）。
 * 位移只由父容器一次 translateX 完成，lane 不自带 transform（结构红线）。
 *
 * 这里只放纯计算，不放 React 状态，便于逐条验证位移语义。
 */

export type LaneRelation = 'root' | 'child' | 'draft'

export interface Lane {
  /** 节点 id；null 表示起草占位格（桌面右栏起草、手机无此格） */
  nodeId: string | null
  relation: LaneRelation
}

/** 桌面视口固定显示的格数：中栏 + 右栏。 */
export const LANES_IN_VIEW = 2

/**
 * 桌面 lane 序列：祖先链（root…center）+ 右栏。
 * 右栏缺席时末尾补 draft 起草占位，保证视口永远能框住相邻两格。
 *
 * drafting 为真时末格恒为起草位（decisions/2026-11-19 §二.3 planAsk 中栏选文：
 * 「两栏不动，右栏切起草态」）——pane 的 rightNodeId 保持不动（取消起草后原子对话
 * 原位回位），但右栏的视觉形态换成起草位，否则旧子对话格占着右栏、起草框无处渲染。
 */
export function computeTrack(
  centerPath: string[],
  rightNodeId: string | null,
  drafting = false,
): Lane[] {
  const lanes: Lane[] = centerPath.map((id, index) => ({
    nodeId: id,
    relation: index === 0 ? 'root' : 'child',
  }))
  lanes.push(
    drafting || rightNodeId === null
      ? { nodeId: null, relation: 'draft' }
      : { nodeId: rightNodeId, relation: 'child' },
  )
  return lanes
}

/**
 * 手机 lane 序列：只放路由链上的对话（当前节点 + 祖先），不收右栏。
 * 屏小一次只展示一个对话；祖先格留在屏外供位移动画。关系标注与 computeTrack 同源。
 */
export function routeTrack(centerPath: string[]): Lane[] {
  return centerPath.map((id, index) => ({
    nodeId: id,
    relation: index === 0 ? 'root' : 'child',
  }))
}

/** 视口左边界（中栏）在轨道上的索引；视口恒贴轨道末端。 */
export function centerIndex(lanes: Lane[]): number {
  return Math.max(0, lanes.length - LANES_IN_VIEW)
}

/**
 * 桌面轨道整体平移量（px）：负值向左推进；-0 不能露给 CSS（起点用 0）。
 */
export function trackOffset(lanes: Lane[], laneWidth: number): number {
  const offset = -centerIndex(lanes) * laneWidth
  return offset === 0 ? 0 : offset
}

/**
 * 手机单位移（px）：视口钉在轨道末格，每深入一代左移一整屏。
 * singlePane 轨道由 routeTrack 生成（不含右栏），语义与桌面 trackOffset 不同。
 */
export function singlePaneOffset(lanes: Lane[], laneWidth: number): number {
  const offset = -Math.max(0, lanes.length - 1) * laneWidth
  return offset === 0 ? 0 : offset
}

/**
 * 每格宽度：桌面末格（右栏）吃掉 centerWidth 之外的余宽，其余格宽=centerWidth；
 * 手机 singlePane 每格铺满视口宽。
 */
export function laneWidthOf(
  index: number,
  length: number,
  singlePane: boolean,
  centerWidth: number,
  viewportWidth: number,
): number {
  if (singlePane) return viewportWidth
  return index === length - 1 ? Math.max(0, viewportWidth - centerWidth) : centerWidth
}

/**
 * 分栏比例（中栏占内容区宽度的比例）。
 * 真机反馈 2026-11-22②③：中/右两栏原来无法手动调整，且右侧 lane 以
 * window.innerWidth 当视口宽——比真实内容区多出整整一个侧栏，右边被裁掉。
 * 修复：宽度一律以舞台容器自身宽度为基准，比例可拖拽并持久化。
 */
export const DEFAULT_PANE_RATIO = 0.5
/** 中栏最小 30%、最大 70%——再窄正文不可读，再宽右栏失去意义。 */
export const MIN_PANE_RATIO = 0.3
export const MAX_PANE_RATIO = 0.7

/** 把任意比例夹进 [MIN_PANE_RATIO, MAX_PANE_RATIO]；非有限值回落默认。 */
export function clampPaneRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) return DEFAULT_PANE_RATIO
  return Math.min(MAX_PANE_RATIO, Math.max(MIN_PANE_RATIO, ratio))
}

/**
 * 两栏宽度（px）：中栏 = 容器宽 × 比例，右栏吃掉余宽。
 * 两者之和恒等于容器宽——末格不再溢出（右侧内容不再被裁）。
 */
export function paneWidths(
  containerWidth: number,
  ratio: number,
): { centerWidth: number; rightWidth: number } {
  const width = Math.max(0, Math.floor(containerWidth))
  const centerWidth = Math.min(width, Math.floor(width * clampPaneRatio(ratio)))
  return { centerWidth, rightWidth: width - centerWidth }
}

/**
 * 拖拽指针位置 → 新的中栏比例。
 * 以容器左边界与宽度换算；容器尚未测量（宽 0）时回落默认比例。
 */
export function ratioFromPointer(
  containerLeft: number,
  containerWidth: number,
  pointerX: number,
): number {
  if (!(containerWidth > 0)) return DEFAULT_PANE_RATIO
  return clampPaneRatio((pointerX - containerLeft) / containerWidth)
}
