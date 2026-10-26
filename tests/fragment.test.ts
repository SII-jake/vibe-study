import { describe, expect, it } from 'vitest'
import { splitFragments, toPlainText } from '../src/domain/fragment'

describe('toPlainText', () => {
  it('剥离行内标记后保留文字', () => {
    expect(toPlainText('**复利**是指 `利息` 生息')).toBe('复利是指 利息 生息')
  })

  it('链接只保留文字', () => {
    expect(toPlainText('参见[维基](https://example.com/a)说明')).toBe('参见维基说明')
  })

  it('去掉标题与列表前缀符号', () => {
    expect(toPlainText('## 标题\n\n- 项目一')).toBe('标题 项目一')
  })

  it('保留代码块内的文字内容', () => {
    expect(toPlainText('```js\nconst a = 1\n```')).toBe('const a = 1')
  })
})

describe('splitFragments', () => {
  const markdown = [
    '# 复利',
    '',
    '复利是指利息也产生利息。',
    '',
    '- 第一点',
    '- 第二点',
    '',
    '```js',
    'const a = 1',
    '',
    'const b = 2',
    '```',
    '',
    '> 引用一句',
    '',
    '| 项 | 值 |',
    '|---|---|',
    '| 1 | 2 |',
  ].join('\n')

  it('按块切分并识别类型', () => {
    expect(splitFragments(markdown).map((f) => f.kind)).toEqual([
      'heading',
      'paragraph',
      'list',
      'code',
      'quote',
      'table',
    ])
  })

  it('代码块内部的空行不切分片段', () => {
    const code = splitFragments(markdown).find((f) => f.kind === 'code')
    expect(code?.raw).toContain('const a = 1\n\nconst b = 2')
  })

  it('片段序号连续从零开始', () => {
    expect(splitFragments(markdown).map((f) => f.index)).toEqual([0, 1, 2, 3, 4, 5])
  })

  it('连续正文行合并为一个段落片段', () => {
    expect(splitFragments('第一行\n第二行').map((f) => f.text)).toEqual(['第一行 第二行'])
  })

  it('空文本返回空数组', () => {
    expect(splitFragments('   \n\n ')).toEqual([])
  })
})
