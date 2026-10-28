// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useElementWidth } from '../src/ui/use-element-width'

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
  vi.unstubAllGlobals()
})

function Probe() {
  const [ref, width] = useElementWidth<HTMLDivElement>()
  return (
    <div ref={ref} data-testid="box">
      <span data-testid="width">{Math.round(width)}</span>
    </div>
  )
}

describe('useElementWidth', () => {
  it('挂载后即测量容器宽度', () => {
    const spy = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockReturnValue({ width: 840 } as DOMRect)

    act(() => root.render(<Probe />))
    expect(container.querySelector('[data-testid="width"]')?.textContent).toBe('840')
    spy.mockRestore()
  })

  it('没有 ResizeObserver 时退回 window resize 监听', () => {
    vi.stubGlobal('ResizeObserver', undefined)
    const spy = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockReturnValue({ width: 600 } as DOMRect)

    act(() => root.render(<Probe />))
    expect(container.querySelector('[data-testid="width"]')?.textContent).toBe('600')
    spy.mockRestore()
  })
})
