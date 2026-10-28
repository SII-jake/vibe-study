// @vitest-environment jsdom
// 右栏宽度由用户手动拖分隔条确定：向左拖右栏变宽、向右拖变窄，
// 且被限定在最小/最大宽度之间，不再跟随鼠标悬停自动变。
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { usePaneWidth } from '../src/ui/use-pane-width'

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

function Probe({ initial = 360, min = 240, max = 560 }: { initial?: number; min?: number; max?: number }) {
  const [width, dragging, startDrag] = usePaneWidth({ initial, min, max })
  return (
    <div data-dragging={dragging ? '1' : '0'}>
      <span data-testid="width">{width}</span>
      <button data-testid="handle" onPointerDown={startDrag} />
    </div>
  )
}

function render(el: React.ReactElement) {
  act(() => root.render(el))
}

function pointerEvent(type: string, clientX: number): Event {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.assign(event, { clientX })
  return event
}

const handle = () => container.querySelector<HTMLElement>('[data-testid="handle"]')!
const width = () => Number(container.querySelector('[data-testid="width"]')?.textContent)
const dragging = () => container.querySelector('div')?.dataset.dragging === '1'

describe('usePaneWidth', () => {
  it('初始宽度取 initial', () => {
    render(<Probe initial={360} />)
    expect(width()).toBe(360)
    expect(dragging()).toBe(false)
  })

  it('按住分隔条向左拖（远离右栏）会让右栏变宽', () => {
    render(<Probe initial={360} />)
    act(() => handle().dispatchEvent(pointerEvent('pointerdown', 800)))
    expect(dragging()).toBe(true)
    act(() => window.dispatchEvent(pointerEvent('pointermove', 720)))
    expect(width()).toBe(440)
    act(() => window.dispatchEvent(pointerEvent('pointerup', 720)))
    expect(dragging()).toBe(false)
  })

  it('向右拖（朝右栏方向）会让右栏变窄', () => {
    render(<Probe initial={360} />)
    act(() => handle().dispatchEvent(pointerEvent('pointerdown', 800)))
    act(() => window.dispatchEvent(pointerEvent('pointermove', 900)))
    expect(width()).toBe(260)
    act(() => window.dispatchEvent(pointerEvent('pointerup', 900)))
  })

  it('宽度被钳制在最小值与最大值之间', () => {
    render(<Probe initial={360} min={240} max={560} />)
    act(() => handle().dispatchEvent(pointerEvent('pointerdown', 800)))
    act(() => window.dispatchEvent(pointerEvent('pointermove', 100)))
    expect(width()).toBe(560) // 不越过 max
    act(() => window.dispatchEvent(pointerEvent('pointermove', 2000)))
    expect(width()).toBe(240) // 不越过 min
    act(() => window.dispatchEvent(pointerEvent('pointerup', 2000)))
  })

  it('松手后再移动鼠标不会影响宽度', () => {
    render(<Probe initial={360} />)
    act(() => handle().dispatchEvent(pointerEvent('pointerdown', 800)))
    act(() => window.dispatchEvent(pointerEvent('pointermove', 720)))
    act(() => window.dispatchEvent(pointerEvent('pointerup', 720)))
    act(() => window.dispatchEvent(pointerEvent('pointermove', 100)))
    expect(width()).toBe(440)
  })

  it('连续两次拖拽都从松手时的宽度继续', () => {
    render(<Probe initial={360} />)
    act(() => handle().dispatchEvent(pointerEvent('pointerdown', 800)))
    act(() => window.dispatchEvent(pointerEvent('pointermove', 720)))
    act(() => window.dispatchEvent(pointerEvent('pointerup', 720)))
    // 第二次从 440 起步
    act(() => handle().dispatchEvent(pointerEvent('pointerdown', 500)))
    act(() => window.dispatchEvent(pointerEvent('pointermove', 460)))
    expect(width()).toBe(480)
    act(() => window.dispatchEvent(pointerEvent('pointerup', 460)))
  })
})
