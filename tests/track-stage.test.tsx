// @vitest-environment jsdom
// 轨道舞台：整条轨道渲染成一列 lane，位移只施加在轨道父容器上。
// 这是「两栏作为整体移动」的结构保证 —— 只要单独给 lane 加 transform，
// 就又会退化成两块面板各动各的。
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TrackStage } from '../src/ui/track-stage'
import { computeTrack } from '../src/app/track-view'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function render(el: React.ReactElement) {
  act(() => root.render(el))
}

const laneLabel = (nodeId: string | null) => nodeId ?? '起草中'

function stage(lanes: ReturnType<typeof computeTrack>, centerWidth = 400, viewportWidth = 800) {
  return (
    <TrackStage
      lanes={lanes}
      centerWidth={centerWidth}
      viewportWidth={viewportWidth}
      renderLane={(lane) => <span className="lane-body">{laneLabel(lane.nodeId)}</span>}
    />
  )
}

const trackEl = () => container.querySelector<HTMLElement>('.track-stage-track')!

describe('TrackStage', () => {
  it('整条轨道按顺序渲染成 lane，祖先也在场（回退时才看得到）', () => {
    render(stage(computeTrack(['root', 'a1'], 'b1')))
    const lanes = [...container.querySelectorAll('.track-lane')]
    expect(lanes).toHaveLength(3)
    expect(lanes.map((lane) => lane.textContent)).toEqual(['root', 'a1', 'b1'])
  })

  it('位移只施加在轨道父容器上，lane 自身不带 transform', () => {
    render(stage(computeTrack(['root', 'a1'], 'b1')))

    expect(trackEl().style.transform).toBe('translateX(-400px)')
    // 关键断言：任何 lane 都不允许有自己的位移
    container.querySelectorAll<HTMLElement>('.track-lane').forEach((lane) => {
      expect(lane.style.transform).toBe('')
    })
  })

  it('中栏停在轨道起点时偏移为 0', () => {
    render(stage(computeTrack(['root'], 'a1')))
    expect(trackEl().style.transform).toBe('translateX(0px)')
  })

  it('下潜一代只让轨道整体左移一个中栏宽度', () => {
    render(stage(computeTrack(['root'], 'a1')))
    expect(trackEl().style.transform).toBe('translateX(0px)')

    render(stage(computeTrack(['root', 'a1'], 'b1')))
    expect(trackEl().style.transform).toBe('translateX(-400px)')
  })

  it('右栏宽度 = 视口宽 - 中栏宽，两栏恰好铺满视口', () => {
    render(stage(computeTrack(['root'], 'a1'), 400, 1000))
    const lanes = [...container.querySelectorAll<HTMLElement>('.track-lane')]
    const widths = lanes.map((lane) => lane.style.width)
    // 祖先/中栏用中栏宽，末格占据剩下的全部视口宽度
    expect(widths[0]).toBe('400px')
    expect(widths[1]).toBe('600px')
  })

  it('拖动改变中栏宽度时，末格宽度同步让出，位移量随之重算', () => {
    const lanes = computeTrack(['root', 'a1'], 'b1')
    render(stage(lanes, 400, 1000))
    expect(trackEl().style.transform).toBe('translateX(-400px)')

    render(stage(lanes, 550, 1000))
    const last = container.querySelectorAll<HTMLElement>('.track-lane')[2]!
    expect(last.style.width).toBe('450px')
    expect(trackEl().style.transform).toBe('translateX(-550px)')
  })
})
