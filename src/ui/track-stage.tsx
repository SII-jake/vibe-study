import type { ReactNode } from 'react'
import { type Lane, singlePaneOffset, trackOffset } from '../app/track-view'

export interface TrackStageProps {
  /** 整条轨道：根 → … → 中栏 → 右栏，一次全部渲染 */
  lanes: Lane[]
  /** 中栏（及祖先）的宽度，等于用户拖出来的分栏位置 */
  centerWidth: number
  /** 视口总宽度；末格吃掉剩下的部分 */
  viewportWidth: number
  /** 单栏模式（窄视口）：每格铺满视口、视口一次只框住一栏，位移按整屏推进 */
  singlePane?: boolean
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
  singlePane = false,
  renderLane,
}: TrackStageProps) {
  const lastIndex = lanes.length - 1
  // 单栏：各格与视口同宽，双栏：末格（右栏）吃掉中栏之外的剩余视口
  const laneWidth = (index: number) =>
    singlePane ? viewportWidth : index === lastIndex ? Math.max(0, viewportWidth - centerWidth) : centerWidth
  // 单栏钉中栏不看末端：小屏只读一个对话，右栏不能把当前对话顶出视口
  const offset = singlePane
    ? singlePaneOffset(lanes, viewportWidth)
    : trackOffset(lanes, centerWidth)

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
            style={{ width: `${laneWidth(index)}px` }}
          >
            {renderLane(lane, index)}
          </div>
        ))}
      </div>
    </div>
  )
}
