/**
 * 三栏的下潜规则：中栏是当前对话，右栏是子对话。
 * 深度不靠页面跳转表达，而是靠「右栏内容沉入中栏」的空间位移 ——
 * 这样读父对话的同时能看见子对话在生成，回退也不会丢上下文。
 *
 * 这里只放纯计算，不放 React 状态，便于逐条验证位移语义。
 */

export type PaneSide = 'main' | 'right'

export interface PaneView {
  /** 中栏展示的节点 */
  centerNodeId: string | null
  /** 右栏展示的子对话 */
  rightNodeId: string | null
}

/**
 * 选中一段、开始起草时的两栏安排。
 * - 中栏选中：两栏都不动，右栏只是换成起草态
 * - 右栏选中：当前子对话先沉入中栏，右栏让给新的子对话
 */
export function planAsk(view: PaneView, pane: PaneSide): PaneView {
  if (pane === 'main' || view.rightNodeId === null) return view
  return { centerNodeId: view.rightNodeId, rightNodeId: null }
}

/**
 * 子对话落位的唯一规则：无论来自「选中提问后提交」还是「点开分支卡片」，
 * 新子对话一律进右栏；若右栏原有内容，则它先沉入中栏 —— 这就是「连续下潜」。
 *
 * - 从中栏发起：中栏不动，子对话进右栏（保留父对话可读）
 * - 从右栏发起：当前右栏沉入中栏，新的子对话占右栏
 */
export function planPlaceChild(view: PaneView, childId: string, pane: PaneSide): PaneView {
  if (pane === 'main') return { centerNodeId: view.centerNodeId, rightNodeId: childId }
  return { centerNodeId: view.rightNodeId, rightNodeId: childId }
}

/** 「设为当前」：右栏升入中栏并清空右栏。 */
export function planPromote(view: PaneView): PaneView {
  if (view.rightNodeId === null) return view
  return { centerNodeId: view.rightNodeId, rightNodeId: null }
}

/**
 * 返回上一级：视口左移一格。
 * 轨道语义下「返回」不是清空右栏 —— 刚才的中栏正好是上一级的子对话，
 * 它应该留在右栏，用户能同时对照父子两级。
 */
export function planGoBack(view: PaneView, parentNodeId: string | null): PaneView {
  if (parentNodeId === null) return view
  return { centerNodeId: parentNodeId, rightNodeId: view.centerNodeId }
}
