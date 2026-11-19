// track 计算纯函数（decisions/2026-11-19：双端同一 lane 轨道，视口钉格数是唯一端差）
// 桌面 LANES_IN_VIEW=2（中栏+右栏）；手机 singlePane 每格铺满、视口钉轨道末格。
// 语义源：feature/chat-ui-tools track-view.ts / track-stage.tsx。
import { describe, expect, it } from 'vitest'
import {
  LANES_IN_VIEW,
  centerIndex,
  computeTrack,
  laneWidthOf,
  routeTrack,
  singlePaneOffset,
  trackOffset,
  type Lane,
} from '../web/src/services/chat/trackView.js'

describe('computeTrack（桌面 lane 序列）', () => {
  it('由祖先链+右栏推导，右栏缺席补起草占位', () => {
    expect(computeTrack(['root', 'a'], 'b')).toEqual([
      { nodeId: 'root', relation: 'root' },
      { nodeId: 'a', relation: 'child' },
      { nodeId: 'b', relation: 'child' },
    ])
  })

  it('右栏为空时末尾补 draft 占位，视口总能框住两格', () => {
    const lanes = computeTrack(['root'], null)
    expect(lanes).toEqual([
      { nodeId: 'root', relation: 'root' },
      { nodeId: null, relation: 'draft' },
    ])
  })
})

describe('routeTrack（手机 lane 序列，只放路由链）', () => {
  it('只含当前节点与祖先，无右栏无 draft', () => {
    expect(routeTrack(['root', 'a', 'b'])).toEqual([
      { nodeId: 'root', relation: 'root' },
      { nodeId: 'a', relation: 'child' },
      { nodeId: 'b', relation: 'child' },
    ])
  })
})

describe('centerIndex / 视口恒贴轨道末端', () => {
  it('桌面两格视口：轨道长度<=2 时中栏在 0，否则钉末尾', () => {
    expect(centerIndex([{ nodeId: 'root', relation: 'root' } as Lane])).toBe(0)
    expect(
      centerIndex([
        { nodeId: 'root', relation: 'root' },
        { nodeId: 'a', relation: 'child' },
        { nodeId: 'b', relation: 'child' },
      ] as Lane[]),
    ).toBe(1)
  })
})

describe('trackOffset（桌面位移）', () => {
  it('轨道整体 translateX = -centerIndex * laneWidth；起点为 0 且不露 -0', () => {
    const two: Lane[] = [
      { nodeId: 'root', relation: 'root' },
      { nodeId: null, relation: 'draft' },
    ]
    expect(trackOffset(two, 480)).toBe(0)
    const three: Lane[] = [
      { nodeId: 'root', relation: 'root' },
      { nodeId: 'a', relation: 'child' },
      { nodeId: 'b', relation: 'child' },
    ]
    expect(trackOffset(three, 480)).toBe(-480)
  })
})

describe('singlePaneOffset（手机位移，视口钉末格）', () => {
  it('位移 = -(长度-1) * 视口宽；单格为 0 不露 -0', () => {
    expect(singlePaneOffset(routeTrack(['root']), 390)).toBe(0)
    expect(singlePaneOffset(routeTrack(['root', 'a', 'b']), 390)).toBe(-780)
  })
})

describe('laneWidthOf（每格宽）', () => {
  it('桌面：末格吃余宽，其余=centerWidth；手机：每格=视口宽', () => {
    expect(laneWidthOf(0, 3, false, 500, 1000)).toBe(500)
    expect(laneWidthOf(2, 3, false, 500, 1000)).toBe(500)
    expect(laneWidthOf(0, 3, true, 500, 1000)).toBe(1000)
    expect(laneWidthOf(2, 3, true, 500, 1000)).toBe(1000)
  })

  it('LANES_IN_VIEW 登记为 2（桌面双格视口常量）', () => {
    expect(LANES_IN_VIEW).toBe(2)
  })
})
