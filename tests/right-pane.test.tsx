// @vitest-environment jsdom
// 右栏出现/消失不是瞬间切换：打开时自右滑入，关闭时向右滑出后再卸载，
// 让"父对话"和"子对话"看起来本就相邻，只是窗口挪了位置。
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RightPane } from '../src/ui/right-pane'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root
let animateStub: ReturnType<typeof vi.fn>
let finishedResolvers: Array<() => void>

beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  finishedResolvers = []
  animateStub = vi.fn(() => ({
    finished: new Promise<void>((resolve) => finishedResolvers.push(resolve)),
    cancel: () => {},
    pause: () => {},
    play: () => {},
  }))
  Object.defineProperty(Element.prototype, 'animate', { value: animateStub, configurable: true })
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
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  delete (Element.prototype as unknown as Record<string, unknown>).animate
})

function render(el: React.ReactElement) {
  act(() => root.render(el))
}

const pane = () => container.querySelector('.app-right')

describe('RightPane', () => {
  it('open=false 时不渲染右栏', () => {
    render(<RightPane open={false}>内容</RightPane>)
    expect(pane()).toBeNull()
  })

  it('打开：自右侧滑入（从正位移到 0），并通知可视状态', () => {
    const onVisibilityChange = vi.fn()
    render(
      <RightPane open={true} onVisibilityChange={onVisibilityChange}>
        内容
      </RightPane>,
    )
    expect(pane()).not.toBeNull()
    expect(pane()?.textContent).toBe('内容')

    expect(animateStub).toHaveBeenCalled()
    const frames = animateStub.mock.calls[0]?.[0] as Array<{ transform?: string }>
    expect(frames[0]?.transform).toContain('translateX(')
    expect(frames[0]?.transform).not.toContain('translateX(0px)')
    expect(frames[0]?.transform).not.toContain('translateX(-')
    expect(frames[frames.length - 1]?.transform).toBe('translateX(0px)')

    expect(onVisibilityChange).toHaveBeenCalledWith(true)
  })

  it('已经打开的右栏在内容切换时也自右侧滑入，与中栏的下潜同方向同速度', () => {
    // 用户指认的"两栏各动各的"其中一块：中栏在播 DiveSlide，
    // 右栏却被暗自替换 —— 下潜必须让它也有轨迹。
    render(
      <RightPane open={true} motionKey="a1">
        子对话 a1
      </RightPane>,
    )
    const callsBefore = animateStub.mock.calls.length

    render(
      <RightPane open={true} motionKey="b1">
        子对话 b1
      </RightPane>,
    )

    expect(animateStub.mock.calls.length).toBeGreaterThan(callsBefore)
    const frames = animateStub.mock.calls[callsBefore]?.[0] as Array<{
      transform?: string
    }>
    // 从正位移滑入、落回 0；方向与速度要跟 DiveSlide 一致
    expect(frames[0]?.transform).toContain('translateX(')
    expect(frames[0]?.transform).not.toContain('translateX(0px)')
    expect(frames[0]?.transform).not.toContain('translateX(-')
    expect(frames[frames.length - 1]?.transform).toBe('translateX(0px)')
  })

  it('motionKey 不变的重渲染不重放动画', () => {
    render(
      <RightPane open={true} motionKey="a1">
        子对话 a1
      </RightPane>,
    )
    const callsBefore = animateStub.mock.calls.length
    render(
      <RightPane open={true} motionKey="a1">
        子对话 a1（重渲染）
      </RightPane>,
    )
    expect(animateStub.mock.calls.length).toBe(callsBefore)
  })

  it('从关闭状态打开同样自右侧滑入，而不是仅在首帧就位', () => {
    // open 从 false 翻成 true 时 aside 尚未挂进 DOM，
    // 进场动画必须等它出现后播放，否则等于悄无声息地打开门
    render(<RightPane open={false}>内容</RightPane>)
    expect(pane()).toBeNull()
    render(<RightPane open={true}>内容</RightPane>)
    expect(pane()).not.toBeNull()
    expect(animateStub).toHaveBeenCalled()
    const frames = animateStub.mock.calls[0]?.[0] as Array<{ transform?: string }>
    expect(frames[frames.length - 1]?.transform).toBe('translateX(0px)')
  })

  it('关闭动画期间保留当时的内容，播的不是空槽', () => {
    render(
      <RightPane open={true}>
        <div className="kept">当时的子对话</div>
      </RightPane>,
    )
    render(<RightPane open={false}>内容</RightPane>)
    // 离场动画未完成，内容仍在场
    expect(pane()?.querySelector('.kept')?.textContent).toBe('当时的子对话')
  })

  it('关闭：先向右滑出，动画结束后才卸载', async () => {
    render(<RightPane open={true}>内容</RightPane>)
    const callsBeforeClose = animateStub.mock.calls.length

    render(<RightPane open={false}>内容</RightPane>)
    // 滑道未完成时元素仍在场
    expect(pane()).not.toBeNull()

    const doneCalls = animateStub.mock.calls.length - callsBeforeClose
    expect(doneCalls).toBeGreaterThan(0)
    const exitFrames = animateStub.mock.calls[callsBeforeClose]?.[0] as Array<{
      transform?: string
    }>
    // 起点归零、终点为正位移 —— 向右滑离
    expect(exitFrames[0]?.transform).toBe('translateX(0px)')
    expect(exitFrames[exitFrames.length - 1]?.transform).toContain('translateX(')
    expect(exitFrames[exitFrames.length - 1]?.transform).not.toBe('translateX(0px)')
    expect(exitFrames[exitFrames.length - 1]?.transform).not.toContain('translateX(-')

    render(<RightPane open={false}>内容</RightPane>)
    expect(pane()).not.toBeNull()
    act(() => {
      finishedResolvers.forEach((resolve) => resolve())
    })
    await act(async () => Promise.resolve())
    expect(pane()).toBeNull()
  })

  it('关闭结束通过 onVisibilityChange(false) 通知，让 grid 能同步收窄', async () => {
    const onVisibilityChange = vi.fn()
    render(
      <RightPane open={true} onVisibilityChange={onVisibilityChange}>
        内容
      </RightPane>,
    )
    render(
      <RightPane open={false} onVisibilityChange={onVisibilityChange}>
        内容
      </RightPane>,
    )
    act(() => {
      finishedResolvers.forEach((resolve) => resolve())
    })
    await act(async () => Promise.resolve())
    expect(onVisibilityChange).toHaveBeenLastCalledWith(false)
  })

  it('多次快速开关：关闭动画中重新打开，立即取消出场并回到正向入场', () => {
    render(<RightPane open={true}>内容</RightPane>)
    render(<RightPane open={false}>内容</RightPane>)
    render(<RightPane open={true}>内容</RightPane>)
    // 存在即正确，状态不应卡在"半卸载"
    expect(pane()).not.toBeNull()
    const lastFrames = animateStub.mock.calls[animateStub.mock.calls.length - 1]?.[0] as Array<{
      transform?: string
    }>
    expect(lastFrames[lastFrames.length - 1]?.transform).toBe('translateX(0px)')
  })

  it('尊重 prefers-reduced-motion：不播动画，直接出现/消失', () => {
    window.matchMedia = ((query: string) => ({
      matches: query.includes('reduced-motion'),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia

    render(<RightPane open={true}>内容</RightPane>)
    expect(pane()).not.toBeNull()
    render(<RightPane open={false}>内容</RightPane>)
    expect(pane()).toBeNull()
    expect(animateStub).not.toHaveBeenCalled()
  })
})
