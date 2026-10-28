import { describe, expect, it } from 'vitest'
import {
  centerIndex,
  centerLane,
  computeTrack,
  rightLane,
  trackOffset,
} from '../src/app/track-view'

/**
 * 轨道 = 根到中栏节点的深度链 + 末尾一格（右栏）。
 * 视口恒贴轨道末端，取最后两格；偏移完全由链长推导，不另存状态。
 */

describe('computeTrack', () => {
  it('根 + 已生成的右栏子对话 → 两格轨道', () => {
    const lanes = computeTrack(['root'], 'a1')
    expect(lanes.map((lane) => lane.nodeId)).toEqual(['root', 'a1'])
    expect(lanes.map((lane) => lane.relation)).toEqual(['root', 'child'])
  })

  it('右栏还在起草时末尾补一格占位，仍占轨道一格', () => {
    const lanes = computeTrack(['root', 'a1'], null)
    expect(lanes.map((lane) => lane.nodeId)).toEqual(['root', 'a1', null])
    expect(lanes[lanes.length - 1]?.relation).toBe('draft')
  })

  it('每格按深度标注父子关系，根单独标 root', () => {
    const lanes = computeTrack(['root', 'a1', 'b1'], 'c1')
    expect(lanes.map((lane) => lane.relation)).toEqual(['root', 'child', 'child', 'child'])
  })
})

describe('视口取最后两格', () => {
  it('三格轨道：中栏是第二格、右栏是第三格', () => {
    const lanes = computeTrack(['root'], 'a1')
    expect(lanes).toHaveLength(2)
    expect(centerIndex(lanes)).toBe(0)
    expect(centerLane(lanes)?.nodeId).toBe('root')
    expect(rightLane(lanes)?.nodeId).toBe('a1')
  })

  it('四格轨道：中栏索引推进到 2，父子依然相邻', () => {
    // 根 → a1（中栏）→ b1（右栏）→ 起草位
    const lanes = computeTrack(['root', 'a1'], 'b1')
    expect(lanes).toHaveLength(3)
    expect(centerIndex(lanes)).toBe(1)
    expect(centerLane(lanes)?.nodeId).toBe('a1')
    expect(rightLane(lanes)?.nodeId).toBe('b1')
  })

  it('只有根时视口停在轨道起点，右栏是起草位', () => {
    const lanes = computeTrack(['root'], null)
    expect(centerIndex(lanes)).toBe(0)
    expect(centerLane(lanes)?.nodeId).toBe('root')
    expect(rightLane(lanes)?.nodeId).toBeNull()
  })

  it('极短轨道也不返回越界索引', () => {
    expect(centerIndex([{ nodeId: 'root', relation: 'root' }])).toBe(0)
  })
})

describe('trackOffset：整条轨道一次平移', () => {
  it('中栏在轨道起点时偏移为 0（不是 -0）', () => {
    expect(trackOffset(computeTrack(['root'], null), 640)).toBe(0)
    expect(trackOffset(computeTrack(['root'], 'a1'), 640)).toBe(0)
  })

  it('每深入一代，偏移左移一个 lane 宽度', () => {
    const lanes = computeTrack(['root', 'a1'], 'b1')
    expect(trackOffset(lanes, 640)).toBe(-640)
  })

  it('下潜一次只让整条轨道平移一格', () => {
    const before = computeTrack(['root'], 'a1') // 中栏 root，右栏 a1
    const after = computeTrack(['root', 'a1'], 'b1') // 中栏 a1，右栏 b1
    expect(trackOffset(before, 600) - trackOffset(after, 600)).toBe(600)
  })
})
