// @vitest-environment jsdom
// 片段级锚点（decisions/2026-11-19）：回答的 AST 顶层块各为一个片段，
// 渲染时必须带 data-fragment-index 与顶层块序号一致——选区捕获、
// 片段下引子卡挂载、锚点定位都以此为唯一编号来源。
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, describe, expect, it } from 'vitest'

// 桩：jsdom 无 matchMedia，Markdown 依赖链（MermaidDiagram→theme.ts）引用它需要
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  }),
})

// import 须在桩之后生效 —— vitest 提升静态 import，改走动态
const { Markdown } = await import('../web/src/components/markdown/Markdown.js')

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => act(() => root.unmount()))

describe('data-fragment-index 片段编号', () => {
  it('顶层块按序号获得 data-fragment-index（0,1,2…），每块一个宿主', () => {
    const content = [
      '第一段正文。',
      '',
      '第二段正文。',
      '',
      '```js\nconsole.log(1)\n```',
      '',
      '## 小节标题',
      '',
      '- 列表项一\n- 列表项二',
    ].join('\n')
    act(() => {
      root.render(
        <Markdown content={content} loading={false} cacheKey="t1" disableLink={false} />,
      )
    })
    const frags = container.querySelectorAll('[data-fragment-index]')
    expect(frags.length).toBe(5)
    expect([...frags].map((el) => el.getAttribute('data-fragment-index'))).toEqual([
      '0',
      '1',
      '2',
      '3',
      '4',
    ])
  })

  it('单段回答有一个片段宿主（index 0），data-ask-text 在其上游', () => {
    act(() => {
      root.render(
        <div data-ask-text data-message-id="m1">
          <Markdown content={'只有一段话。'} loading={false} cacheKey="t2" disableLink={false} />
        </div>,
      )
    })
    const frag = container.querySelector('[data-fragment-index="0"]')
    expect(frag).not.toBeNull()
    expect(frag!.closest('[data-ask-text]')).not.toBeNull()
    expect(frag!.closest('[data-message-id]')!.getAttribute('data-message-id')).toBe('m1')
  })
})
