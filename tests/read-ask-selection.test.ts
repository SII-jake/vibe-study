// @vitest-environment jsdom
// 片段级锚点（decisions/2026-11-19）：选区捕获除 anchorMessageId/anchorText 外
// 必须记录 fragmentIndex（closest('[data-fragment-index]')）；
// 无片段宿主的旧渲染退化为消息级（fragmentIndex: null），不得阻塞追问。
import { describe, expect, it } from 'vitest'

describe('readAskSelection 片段级捕获', () => {
  it('选区落片段内时记录 fragmentIndex', async () => {
    const { readAskSelection } = await import('../web/src/components/session/readAskSelection.js')
    document.body.innerHTML = `
      <div data-ask-text data-message-id="m1">
        <div data-fragment-index="0"><p>第一段内容</p></div>
        <div data-fragment-index="1"><p>第二段内容</p></div>
      </div>`
    const target = document.querySelector('[data-fragment-index="1"] p')!.firstChild!
    const range = document.createRange()
    range.selectNodeContents(target)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)

    const result = readAskSelection(selection)
    expect(result).not.toBeNull()
    expect(result!.anchorMessageId).toBe('m1')
    expect(result!.fragmentIndex).toBe(1)
    expect(result!.anchorText).toContain('第二段')
  })

  it('无片段宿主（旧数据形态）退化为 fragmentIndex null，其余信息照常', async () => {
    const { readAskSelection } = await import('../web/src/components/session/readAskSelection.js')
    document.body.innerHTML = `
      <div data-ask-text data-message-id="m9">
        <p>整条回答算一个片段的旧渲染</p>
      </div>`
    const target = document.querySelector('p')!.firstChild!
    const range = document.createRange()
    range.selectNodeContents(target)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)

    const result = readAskSelection(selection)
    expect(result).not.toBeNull()
    expect(result!.anchorMessageId).toBe('m9')
    expect(result!.fragmentIndex).toBeNull()
  })

  it('空选区/折叠选区返回 null', async () => {
    const { readAskSelection } = await import('../web/src/components/session/readAskSelection.js')
    document.body.innerHTML = `<div data-ask-text data-message-id="m1"><div data-fragment-index="0"><p>x</p></div></div>`
    const selection = window.getSelection()!
    selection.removeAllRanges()
    expect(readAskSelection(selection)).toBeNull()
  })
})
