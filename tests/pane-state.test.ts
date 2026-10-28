import { describe, expect, it } from 'vitest'
import { type PaneView, planAsk, planPlaceChild, planPromote } from '../src/app/pane-state'

const base = { centerNodeId: 'root', rightNodeId: null }
const withRight = { centerNodeId: 'root', rightNodeId: 'a1' }

describe('planAsk', () => {
  it('在中栏选中：两栏都不动，只是右栏开起草态', () => {
    expect(planAsk(base, 'main')).toEqual(base)
    expect(planAsk(withRight, 'main')).toEqual(withRight)
  })

  it('在右栏选中：当前子对话沉入中栏，右栏让给新的子对话', () => {
    // 这条是「连续下潜」的核心：先移中栏，再在右栏展开
    expect(planAsk(withRight, 'right')).toEqual({ centerNodeId: 'a1', rightNodeId: null })
  })

  it('右栏空着时在右栏选中：保持原样，不产生空跳转', () => {
    expect(planAsk(base, 'right')).toEqual(base)
  })
})

describe('planPlaceChild', () => {
  it('中栏点开分支卡片：子对话进右栏，中栏不动', () => {
    expect(planPlaceChild(base, 'a1', 'main')).toEqual({ centerNodeId: 'root', rightNodeId: 'a1' })
  })

  it('右栏点开分支卡片：先让当前右栏沉入中栏，新分支占右栏', () => {
    expect(planPlaceChild(withRight, 'b1', 'right')).toEqual({
      centerNodeId: 'a1',
      rightNodeId: 'b1',
    })
  })

  it('右栏点开自己的第一个分支：同样沉入中栏，避免原地替换丢失上下文', () => {
    expect(planPlaceChild(base, 'a1', 'right')).toEqual({ centerNodeId: null, rightNodeId: 'a1' })
  })
})

describe('planPlaceChild：与发起方位无关的落位规则', () => {
  it('从中栏提交的新子对话只进右栏，中栏保持不变', () => {
    // 中栏选中一段提问、提交后的落位，与点卡片同一套规则
    expect(planPlaceChild(base, 'a1', 'main')).toEqual({ centerNodeId: 'root', rightNodeId: 'a1' })
  })
})

describe('planPromote', () => {
  it('设为当前：右栏升入中栏并清空右栏', () => {
    expect(planPromote(withRight)).toEqual({ centerNodeId: 'a1', rightNodeId: null })
  })

  it('右栏为空时原样返回', () => {
    expect(planPromote(base)).toEqual(base)
  })
})

describe('连续下潜的完整链路', () => {
  it('root → a1 → b1 → c1：每次都在右栏选中/点卡片，中栏逐层跟进', () => {
    let view: PaneView = { centerNodeId: 'root', rightNodeId: null }

    // 中栏选中一段提问并提交 → a1 进右栏，中栏仍是 root
    view = planAsk(view, 'main')
    view = planPlaceChild(view, 'a1', 'main')
    expect(view).toEqual({ centerNodeId: 'root', rightNodeId: 'a1' })

    // 右栏选中一段提问 → 起草时 a1 沉入中栏
    view = planAsk(view, 'right')
    expect(view).toEqual({ centerNodeId: 'a1', rightNodeId: null })
    // 提交 → b1 落到右栏
    view = planPlaceChild(view, 'b1', 'main')
    expect(view).toEqual({ centerNodeId: 'a1', rightNodeId: 'b1' })

    // 右栏里点分支卡片 → b1 沉入中栏，c1 占右栏
    view = planPlaceChild(view, 'c1', 'right')
    expect(view).toEqual({ centerNodeId: 'b1', rightNodeId: 'c1' })
  })
})
