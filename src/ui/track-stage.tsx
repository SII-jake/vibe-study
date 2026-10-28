import type { ReactNode } from 'react'
import { type Lane, trackOffset } from '../app/track-view'

export interface TrackStageProps {
  /** 整条轨道：根 → … → 中栏 → 右栏，一次全部渲染 */
  lanes: Lane[]
  /** 中栏（及祖先）的宽度，等于用户拖出来的分栏位置 */
  centerWidth: number
  /** 视口总宽度；末格吃掉剩下的部分 */
  viewportWidth: number
  renderLane(lane: Lane, index: number): ReactNode
}

/**
 * 轨道舞台：整棵对话链横铺成一列 lane，视口只框住最后两格。
 *
 * 关键约束 —— 位移只施加在轨道父容器上，任何 lane 都不带自己的
 * transform。两栏因此在结构上刚性连成一条轨道、一起移动；
 * 一旦给单个 lane 加位移，就又会退化成「两块面板各动各的」。
 */
export function TrackStage({
  lanes,
  centerWidth,
  viewportWidth,
  renderLane,
}: TrackStageProps) {
  const lastIndex = lanes.length - 1
  // 末格（右栏）吃掉中栏之外的剩余视口
  const rightWidth = Math.max(0, viewportWidth - centerWidth)
  const offset = trackOffset(lanes, centerWidth)

  return (
    <div className="track-stage">
      <div
        className="track-stage-track"
        style={{ transform: `translateX(${offset}px)` }}
      >
        {lanes.map((lane, index) => (
          <div
            key={`${lane.nodeId ?? 'draft'}-${index}`}
            className={`track-lane${index === lastIndex ? ' track-lane-right' : ''}`}
            style={{ width: `${index === lastIndex ? rightWidth : centerWidth}px` }}
          >
            {renderLane(lane, index)}
          </div>
        ))}
      </div>
    </div>
  )
}
