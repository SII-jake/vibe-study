// @vitest-environment jsdom
// TrackStage 容器（decisions/2026-11-19 §二.2 结构红线）：
// 位移 transform 只施加在轨道父容器上，任何 lane 不自带 transform——
// 两格刚性相邻整体平移，"两块面板各动各的"的历史坑以此堵死。
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TrackStage } from '../web/src/components/session/TrackStage.js'
import { computeTrack, routeTrack, type Lane } from '../web/src/services/chat/trackView.js'

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

const renderLane = (lane: Lane, index: number) => (
  <span key={index} data-lane-content={lane.nodeId ?? lane.relation} />
)

describe('TrackStage 结构红线', () => {
  it('全部 lanes 一次渲染，父容器带 translateX，lane 自身无 transform', () => {
    const lanes = computeTrack(['root', 'a'], 'b')
    act(() => {
      root.render(
        <TrackStage lanes={lanes} centerWidth={500} viewportWidth={1200} renderLane={renderLane} />,
      )
    })
    const track = container.querySelector('[data-track]') as HTMLElement
    expect(track).toBeTruthy()
    expect(track.style.transform).toBe('translateX(-500px)')
    const laneEls = container.querySelectorAll('[data-lane]')
    expect(laneEls.length).toBe(3)
    for (const lane of laneEls) {
      expect((lane as HTMLElement).style.transform).toBe('')
    }
  })

  it('桌面末格（右栏）吃余宽，其余格宽=centerWidth', () => {
    const lanes = computeTrack(['root', 'a'], 'b')
    act(() => {
      root.render(
        <TrackStage lanes={lanes} centerWidth={500} viewportWidth={1200} renderLane={renderLane} />,
      )
    })
    const widths = [...container.querySelectorAll('[data-lane]')].map(
      (el) => (el as HTMLElement).style.width,
    )
    expect(widths).toEqual(['500px', '500px', '700px'])
  })

  it('singlePane（手机）：每格铺满视口宽，视口钉轨道末格', () => {
    const lanes = routeTrack(['root', 'a', 'b'])
    act(() => {
      root.render(
        <TrackStage
          lanes={lanes}
          centerWidth={390}
          viewportWidth={390}
          singlePane
          renderLane={renderLane}
        />,
      )
    })
    const track = container.querySelector('[data-track]') as HTMLElement
    expect(track.style.transform).toBe('translateX(-780px)')
    const widths = [...container.querySelectorAll('[data-lane]')].map(
      (el) => (el as HTMLElement).style.width,
    )
    expect(widths).toEqual(['390px', '390px', '390px'])
  })

  it('轨道起点 translateX(0px) 不露 -0', () => {
    const lanes = routeTrack(['root'])
    act(() => {
      root.render(
        <TrackStage
          lanes={lanes}
          centerWidth={390}
          viewportWidth={390}
          singlePane
          renderLane={renderLane}
        />,
      )
    })
    const track = container.querySelector('[data-track]') as HTMLElement
    expect(track.style.transform).toBe('translateX(0px)')
  })
})
