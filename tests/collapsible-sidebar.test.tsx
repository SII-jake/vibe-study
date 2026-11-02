// @vitest-environment jsdom
// 左侧栏可以收起和展开：收起时把宽度让给阅读区，展开按钮悬浮在主区左上角。
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CollapsibleSidebar } from '../src/ui/CollapsibleSidebar'

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

describe('CollapsibleSidebar', () => {
  it('展开形态：渲染侧栏内容与收起按钮', () => {
    render(
      <CollapsibleSidebar collapsed={false} onToggle={() => {}}>
        <p>会话列表</p>
      </CollapsibleSidebar>,
    )
    expect(container.textContent).toContain('会话列表')
    const collapseBtn = container.querySelector('[aria-label="收起左侧栏"]')
    expect(collapseBtn).not.toBeNull()
    // 展开按钮此时不出现
    expect(container.querySelector('[aria-label="展开左侧栏"]')).toBeNull()
  })

  it('展开形态：收起按钮位于侧栏第一个位置（顶部、紧邻设置一行，而不是沉在底部）', () => {
    render(
      <CollapsibleSidebar collapsed={false} onToggle={() => {}}>
        <p>会话列表</p>
      </CollapsibleSidebar>,
    )
    const aside = container.querySelector('.app-sidebar') as HTMLElement
    const collapseBtn = aside.querySelector('[aria-label="收起左侧栏"]') as HTMLElement
    // 用户期望的位置：顶部、与设置按钮同一行区域（曾经沉在底部导致用户以为「看不到」）
    expect(aside.firstElementChild).toBe(collapseBtn)
  })

  it('点收起按钮回调 onToggle(true)', () => {
    const onToggle = vi.fn()
    render(
      <CollapsibleSidebar collapsed={false} onToggle={onToggle}>
        <p>会话列表</p>
      </CollapsibleSidebar>,
    )
    act(() => (container.querySelector('[aria-label="收起左侧栏"]') as HTMLButtonElement).click())
    expect(onToggle).toHaveBeenCalledWith(true)
  })

  it('收起形态：不渲染侧栏内容，显示悬浮展开按钮', () => {
    render(
      <CollapsibleSidebar collapsed onToggle={() => {}}>
        <p>会话列表</p>
      </CollapsibleSidebar>,
    )
    expect(container.textContent).not.toContain('会话列表')
    expect(container.querySelector('[aria-label="展开左侧栏"]')).not.toBeNull()
  })

  it('点展开按钮回调 onToggle(false)', () => {
    const onToggle = vi.fn()
    render(
      <CollapsibleSidebar collapsed onToggle={onToggle}>
        <p>会话列表</p>
      </CollapsibleSidebar>,
    )
    act(() => (container.querySelector('[aria-label="展开左侧栏"]') as HTMLButtonElement).click())
    expect(onToggle).toHaveBeenCalledWith(false)
  })
})
