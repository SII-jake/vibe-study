// @vitest-environment jsdom
// 下潜过渡：右栏内容升入中栏时，旧内容左滑淡出、新内容从右侧滑入，
// 而不是突然整页替换。
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DiveSlide } from '../src/ui/dive-slide'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root
let animateStub: ReturnType<typeof vi.fn>

beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  // jsdom 没有 matchMedia；默认返回不匹配，必要时由单个用例替换
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
    onchange: null,
  })) as unknown as typeof window.matchMedia
  animateStub = vi.fn(() => ({
    finished: Promise.resolve(),
    cancel: () => {},
    pause: () => {},
    play: () => {},
  }))
  // jsdom 没有 Web Animations API，用桩确认确实发起了动画
  Object.defineProperty(Element.prototype, 'animate', { value: animateStub, configurable: true })
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  delete (Element.prototype as unknown as Record<string, unknown>).animate
})

function render(el: React.ReactElement) {
  act(() => root.render(el))
}

describe('DiveSlide', () => {
  it('首次渲染与 trigger 为 null 时不发起动画', () => {
    render(
      <DiveSlide trigger={null}>
        <div className="app-main-target">问题A</div>
      </DiveSlide>,
    )
    expect(animateStub).not.toHaveBeenCalled()
  })

  it('trigger 变化：旧内容快照左滑淡出、新内容从右侧滑入，之后快照被移除', async () => {
    render(
      <DiveSlide trigger={null}>
        <div className="app-main-target">
          <div className="reader-body">问题A的正文</div>
        </div>
      </DiveSlide>,
    )
    expect(animateStub).not.toHaveBeenCalled()

    render(
      <DiveSlide trigger="dive-1">
        <div className="app-main-target">
          <div className="reader-body">问题B的正文</div>
        </div>
      </DiveSlide>,
    )

    const layer = container.querySelector('.dive-layer')!
    const snapshot = layer.querySelector('.dive-snapshot')

    // 旧内容克隆体在场，带着旧文字做滑出
    expect(snapshot?.textContent).toContain('问题A的正文')

    // 发起了两个方向的动画：快照向负方向滑出、包裹层从正右侧滑入
    const argSets = animateStub.mock.calls.map((call) => call[0] as Array<{ transform?: string }>)
    const leftOut = argSets.some((frames) =>
      frames.some((frame) => (frame.transform ?? '').includes('translateX(-')),
    )
    const rightIn = argSets.some(
      (frames) =>
        (frames[0]?.transform ?? '').includes('translateX(') &&
        !(frames[0]?.transform ?? '').includes('translateX(0px)') &&
        !(frames[0]?.transform ?? '').includes('translateX(-') &&
        frames.some((frame) => frame.transform === 'translateX(0px)'),
    )
    expect(leftOut).toBe(true)
    expect(rightIn).toBe(true)

    // 动画结束后快照要被清理，不残留遮挡
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10))
    })
    expect(layer.querySelector('.dive-snapshot')).toBeNull()
  })

  it('trigger 不变的重渲染不重放动画', () => {
    render(
      <DiveSlide trigger={null}>
        <div className="app-main-target">问题A</div>
      </DiveSlide>,
    )
    render(
      <DiveSlide trigger="dive-1">
        <div className="app-main-target">问题B</div>
      </DiveSlide>,
    )
    const callsAfterFirstDive = animateStub.mock.calls.length

    render(
      <DiveSlide trigger="dive-1">
        <div className="app-main-target">问题B（重渲染）</div>
      </DiveSlide>,
    )
    expect(animateStub.mock.calls.length).toBe(callsAfterFirstDive)
  })

  it('第二次下潜能再次动画，用的是当时的旧内容', () => {
    render(
      <DiveSlide trigger={null}>
        <div className="app-main-target">问题A</div>
      </DiveSlide>,
    )
    render(
      <DiveSlide trigger="dive-1">
        <div className="app-main-target">问题B</div>
      </DiveSlide>,
    )
    render(
      <DiveSlide trigger="dive-2">
        <div className="app-main-target">问题C</div>
      </DiveSlide>,
    )
    const snapshots = container.querySelectorAll('.dive-layer .dive-snapshot')
    expect(snapshots[snapshots.length - 1]?.textContent).toContain('问题B')
  })

  it('尊重 prefers-reduced-motion：命中时跳过动画但界面正常替换', () => {
    const original = window.matchMedia
    window.matchMedia = ((query: string) => ({
      matches: query.includes('reduced-motion'),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia

    render(
      <DiveSlide trigger={null}>
        <div className="app-main-target">问题A</div>
      </DiveSlide>,
    )
    render(
      <DiveSlide trigger="dive-1">
        <div className="app-main-target">问题B</div>
      </DiveSlide>,
    )

    expect(animateStub).not.toHaveBeenCalled()
    expect(container.textContent).toContain('问题B')
    expect(container.querySelector('.dive-snapshot')).toBeNull()

    window.matchMedia = original
  })
})
