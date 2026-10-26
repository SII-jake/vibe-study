import { describe, expect, it } from 'vitest'
import { resolveAnchor } from '../src/domain/anchor'
import { splitFragments } from '../src/domain/fragment'

const fragments = splitFragments(
  ['复利是指利息也产生利息。', '', '长期看，时间的影响远大于收益率。'].join('\n'),
)

describe('resolveAnchor', () => {
  it('片段序号有效时定位到该片段', () => {
    expect(resolveAnchor(fragments, { fragmentIndex: 1, text: '时间的影响' })).toEqual({
      fragmentIndex: 1,
      offset: 4,
    })
  })

  it('片段序号失效时按原文全局搜索', () => {
    expect(resolveAnchor(fragments, { fragmentIndex: 9, text: '时间的影响' })).toEqual({
      fragmentIndex: 1,
      offset: 4,
    })
  })

  it('原文被加粗标记打断时仍能定位', () => {
    const bolded = splitFragments('**复利**是指利息生息。')
    expect(resolveAnchor(bolded, { fragmentIndex: 0, text: '复利是指利息' })).toEqual({
      fragmentIndex: 0,
      offset: 0,
    })
  })

  it('原文已不存在时返回 null', () => {
    expect(resolveAnchor(fragments, { fragmentIndex: 0, text: '这句话已删掉' })).toBeNull()
  })

  it('选中文字与纯文本空白不一致时仍能定位', () => {
    const listed = splitFragments('- 第一点\n- 第二点')
    expect(resolveAnchor(listed, { fragmentIndex: 0, text: '第一点第二点' })).toEqual({
      fragmentIndex: 0,
      offset: 0,
    })
  })

  it('空白不一致时偏移映射回原文位置', () => {
    const listed = splitFragments('- 第一点\n- 第二点')
    expect(resolveAnchor(listed, { fragmentIndex: 0, text: '第二点' })?.offset).toBe(4)
  })
})
