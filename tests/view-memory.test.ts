// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import {
  readReadingPosition,
  rememberFocus,
  rememberReadingPosition,
  takeFocus,
} from '../src/ui/view-memory'

beforeEach(() => {
  sessionStorage.clear()
})

describe('阅读位置', () => {
  it('写入后能读回', () => {
    rememberReadingPosition('n1', 420)
    expect(readReadingPosition('n1')).toBe(420)
  })

  it('未记录时返回 null', () => {
    expect(readReadingPosition('n2')).toBeNull()
  })

  it('不同节点互不干扰', () => {
    rememberReadingPosition('n1', 100)
    rememberReadingPosition('n2', 200)
    expect(readReadingPosition('n1')).toBe(100)
    expect(readReadingPosition('n2')).toBe(200)
  })
})

describe('返回锚点', () => {
  const point = { fragmentIndex: 2, text: '利息也产生利息' }

  it('取出后即清除，避免重复高亮', () => {
    rememberFocus('n1', point)
    expect(takeFocus('n1')).toEqual(point)
    expect(takeFocus('n1')).toBeNull()
  })

  it('未记录时返回 null', () => {
    expect(takeFocus('n9')).toBeNull()
  })

  it('记录内容损坏时返回 null 而不是抛错', () => {
    sessionStorage.setItem('vibe-study.focus.n1', '{坏数据')
    expect(takeFocus('n1')).toBeNull()
  })
})
