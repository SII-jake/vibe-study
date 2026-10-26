import { describe, expect, it } from 'vitest'
import { locateRange } from '../src/domain/text-match'

describe('locateRange', () => {
  it('精确命中时返回原文区间', () => {
    expect(locateRange('复利是指利息也产生利息', '利息也')).toEqual({ start: 4, end: 7 })
  })

  it('空白不一致时映射回原文区间', () => {
    expect(locateRange('第一点 第二点', '第一点第二点')).toEqual({ start: 0, end: 7 })
  })

  it('找不到时返回 null', () => {
    expect(locateRange('复利是指利息', '单利')).toBeNull()
  })

  it('空目标返回 null', () => {
    expect(locateRange('复利', '')).toBeNull()
  })

  it('只返回第一处命中', () => {
    expect(locateRange('利息与利息', '利息')).toEqual({ start: 0, end: 2 })
  })
})
