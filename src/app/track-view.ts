/**
 * 轨道视图。
 *
 * 对话树按层次从左向右铺成一条轨道；中栏与右栏不是两块面板，
 * 而是同一个视口在轨道上框住的相邻两格。下潜/回退只让轨道整体
 * 平移一格 —— 位移由父容器一次 transform 完成，两格永远刚性相邻，
 * 结构上不可能再出现「两块面板各动各的」。
 */

/** 视口固定显示的格数：中栏 + 右栏 */
export const LANES_IN_VIEW = 2

export type LaneRelation = 'root' | 'child' | 'draft'

export interface Lane {
  /** 节点 id；null 表示右栏还在起草、等待下潜的占位格 */
  nodeId: string | null
  relation: LaneRelation
}

/**
 * 由「根到中栏节点的深度链」+「右栏节点」推导整条轨道。
 * 右栏为空时末尾补一格起草位，保证视口永远能框住相邻两格。
 */
export function computeTrack(centerPath: string[], rightNodeId: string | null): Lane[] {
  const lanes: Lane[] = centerPath.map((id, index) => ({
    nodeId: id,
    relation: index === 0 ? 'root' : 'child',
  }))

  lanes.push(
    rightNodeId === null
      ? { nodeId: null, relation: 'draft' }
      : { nodeId: rightNodeId, relation: 'child' },
  )

  return lanes
}

/**
 * 视口左边界（中栏）在轨道上的索引。
 * 由轨道长度直接推导，不另存状态：视口恒贴轨道末端。
 */
export function centerIndex(lanes: Lane[]): number {
  return Math.max(0, lanes.length - LANES_IN_VIEW)
}

/** 中栏所在格。 */
export function centerLane(lanes: Lane[]): Lane | null {
  return lanes[centerIndex(lanes)] ?? null
}

/** 右栏所在格（轨道末格）。 */
export function rightLane(lanes: Lane[]): Lane | null {
  return lanes[lanes.length - 1] ?? null
}

/**
 * 轨道整体平移量（px）：负值表示向左推进。
 * 中栏停在轨道起点时为 0。
 */
export function trackOffset(lanes: Lane[], laneWidth: number): number {
  const offset = -centerIndex(lanes) * laneWidth
  // Object.is 区分 -0 / +0，最左端不能把 -0 露给 CSS
  return offset === 0 ? 0 : offset
}
