// pane-state 四条纯函数（decisions/2026-11-19 §二.3，源：feature/chat-ui-tools pane-state.ts）
// 桌面双栏轨道的中/右栏安排全部由此计算，不写 React 状态；
// 手机端 LANES_IN_VIEW=1 时由 track 退化映射消费同一语义。
import { describe, expect, it } from 'vitest'
import {
  planAsk,
  planGoBack,
  planPlaceChild,
  planPromote,
  type PaneView,
} from '../web/src/services/chat/paneState.js'

describe('planPlaceChild（子对话落位唯一规则）', () => {
  it('从中栏发起：中栏不动，子对话进右栏（父对话保持可读）', () => {
    const view: PaneView = { centerNodeId: 'root', rightNodeId: null }
    expect(planPlaceChild(view, 'child-1', 'main')).toEqual({ centerNodeId: 'root', rightNodeId: 'child-1' })
  })

  it('从右栏发起：当前右栏沉入中栏，新子对话占右栏（连续下潜）', () => {
    const view: PaneView = { centerNodeId: 'root', rightNodeId: 'child-1' }
    expect(planPlaceChild(view, 'child-2', 'right')).toEqual({ centerNodeId: 'child-1', rightNodeId: 'child-2' })
  })
})

describe('planAsk（起草安排）', () => {
  it('中栏选中：两栏都不动，右栏只换起草态（本函数本身不产出新值）', () => {
    const view: PaneView = { centerNodeId: 'root', rightNodeId: 'child-1' }
    expect(planAsk(view, 'main')).toEqual(view)
  })

  it('右栏选中：当前子对话先沉入中栏，右栏让给新的起草位', () => {
    const view: PaneView = { centerNodeId: 'root', rightNodeId: 'child-1' }
    expect(planAsk(view, 'right')).toEqual({ centerNodeId: 'child-1', rightNodeId: null })
  })
})

describe('planPromote（设为当前）', () => {
  it('右栏升入中栏并清空右栏', () => {
    const view: PaneView = { centerNodeId: 'root', rightNodeId: 'child-1' }
    expect(planPromote(view)).toEqual({ centerNodeId: 'child-1', rightNodeId: null })
  })

  it('右栏为空时不变', () => {
    const view: PaneView = { centerNodeId: 'root', rightNodeId: null }
    expect(planPromote(view)).toEqual(view)
  })
})

describe('planGoBack（返回上一级=视口左移一格）', () => {
  it('返回不清空右栏：刚读的对话留在右栏，父子两级同时可读', () => {
    const view: PaneView = { centerNodeId: 'child-1', rightNodeId: 'child-2' }
    expect(planGoBack(view, 'root')).toEqual({ centerNodeId: 'root', rightNodeId: 'child-1' })
  })

  it('无父级时不变', () => {
    const view: PaneView = { centerNodeId: 'child-1', rightNodeId: null }
    expect(planGoBack(view, null)).toEqual(view)
  })
})
