// @vitest-environment jsdom
// 「就这段提问」浮动按钮必须挂到 document.body。
// 轨道容器带 transform，按 CSS 规范会成为 position:fixed 后代的包含块；
// 按钮若留在轨道内，left/top 就相对被平移过的轨道，轨道一动按钮就跑出视口。
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AskFab } from '../src/ui/ask-fab'

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

const fab = () => document.querySelector<HTMLButtonElement>('.ask-fab')

describe('AskFab', () => {
  it('渲染到 document.body，而不是留在容器里', () => {
    render(
      <div className="track-stage-track" style={{ transform: 'translateX(-640px)' }}>
        <AskFab centerX={700} top={300} onClick={() => {}} />
      </div>,
    )
    expect(fab()).not.toBeNull()
    // 关键：父级是 body，不受轨道 transform 影响
    expect(fab()?.parentElement).toBe(document.body)
    expect(container.querySelector('.ask-fab')).toBeNull()
  })

  it('用收边后的坐标定位，按钮整体落在视口内', () => {
    render(<AskFab centerX={1430} top={300} onClick={() => {}} />)
    const left = Number.parseFloat(fab()!.style.left)
    const halfWidth = 104 / 2
    expect(left + halfWidth).toBeLessThanOrEqual(window.innerWidth)
  })

  it('点击触发回调', () => {
    const onClick = vi.fn()
    render(<AskFab centerX={400} top={300} onClick={onClick} />)
    act(() => fab()!.click())
    expect(onClick).toHaveBeenCalled()
  })

  it('卸载时把按钮一起移除，不留残影', () => {
    render(<AskFab centerX={400} top={300} onClick={() => {}} />)
    expect(fab()).not.toBeNull()
    render(<div />)
    expect(fab()).toBeNull()
  })
})
