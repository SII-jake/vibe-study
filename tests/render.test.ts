// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { renderFragmentHtml } from '../src/ui/render'

describe('renderFragmentHtml', () => {
  it('段落转成段落标签', () => {
    expect(renderFragmentHtml({ index: 0, kind: 'paragraph', raw: '正文', text: '正文' })).toContain(
      '<p>正文</p>',
    )
  })

  it('标题保留级别', () => {
    expect(renderFragmentHtml({ index: 0, kind: 'heading', raw: '## 小节', text: '小节' })).toContain(
      '<h2>小节</h2>',
    )
  })

  it('列表保留条目结构', () => {
    const html = renderFragmentHtml({
      index: 0,
      kind: 'list',
      raw: '- 一\n- 二',
      text: '一 二',
    })
    expect(html).toContain('<li>一</li>')
    expect(html).toContain('<li>二</li>')
  })

  it('代码块内容被转义而不是当标签解析', () => {
    const html = renderFragmentHtml({
      index: 0,
      kind: 'code',
      raw: '```js\nconst a = "<b>"\n```',
      text: 'const a = "<b>"',
    })
    expect(html).toContain('&lt;b&gt;')
    expect(html).not.toContain('<b>')
  })

  it('危险标签被剔除', () => {
    const html = renderFragmentHtml({
      index: 0,
      kind: 'paragraph',
      raw: '<script>alert(1)</script>正文',
      text: '正文',
    })
    expect(html).not.toContain('<script>')
  })

  it('行内事件属性被剔除', () => {
    const html = renderFragmentHtml({
      index: 0,
      kind: 'paragraph',
      raw: '<img src=x onerror="alert(1)">',
      text: '',
    })
    expect(html).not.toContain('onerror')
  })

  it('链接在新标签打开且带 noreferrer', () => {
    const html = renderFragmentHtml({
      index: 0,
      kind: 'paragraph',
      raw: '见[文档](https://example.com)',
      text: '见文档',
    })
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noreferrer"')
  })
})
