import type { ReactNode } from 'react'
import {
  laneWidthOf,
  singlePaneOffset,
  trackOffset,
  type Lane,
} from '../../services/chat/trackView.js'
import styles from './TrackStage.module.css'

/**
 * 轨道舞台（decisions/2026-11-19 §二.2 结构红线的落地件）：
 * 整棵对话链横铺成一列 lane，视口只框住最后 N 格（桌面 2 / 手机 1）。
 *
 * 关键约束——位移只施加在轨道父容器上，任何 lane 都不带自己的 transform。
 * 两栏因此在结构上刚性连成一条轨道、一起移动；一旦给单个 lane 加位移，
 * 就退化为「两块面板各动各的」（历史坑）。
 */
export function TrackStage({
  lanes,
  centerWidth,
  viewportWidth,
  singlePane = false,
  renderLane,
}: {
  /** 整条轨道：根 → … → 中栏 → 右栏（或草稿位），一次全部渲染 */
  lanes: Lane[]
  /** 中栏（及祖先）的宽度，等于用户拖出来的分栏位置 */
  centerWidth: number
  /** 视口总宽度；末格吃掉剩下的部分 */
  viewportWidth: number
  /** 单栏模式（手机）：每格铺满视口、视口一次只框住一栏，位移按整屏推进 */
  singlePane?: boolean
  renderLane(lane: Lane, index: number): ReactNode
}) {
  const offset = singlePane
    ? singlePaneOffset(lanes, viewportWidth)
    : trackOffset(lanes, centerWidth)

  return (
    <div className={styles.stage}>
      <div className={styles.track} data-track style={{ transform: `translateX(${offset}px)` }}>
        {lanes.map((lane, index) => (
          <div
            key={`${lane.nodeId ?? lane.relation}-${index}`}
            className={styles.lane}
            data-lane
            style={{ width: `${laneWidthOf(index, lanes.length, singlePane, centerWidth, viewportWidth)}px` }}
          >
            {renderLane(lane, index)}
          </div>
        ))}
      </div>
    </div>
  )
}
