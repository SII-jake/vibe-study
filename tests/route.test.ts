import { describe, expect, it } from 'vitest'
import { parseRoute, routeToHash } from '../src/app/route'

describe('parseRoute', () => {
  it('空 hash 落在主题列表', () => {
    expect(parseRoute('')).toEqual({ kind: 'topics' })
  })

  it('识别节点阅读路由', () => {
    expect(parseRoute('#/n/abc')).toEqual({ kind: 'node', nodeId: 'abc' })
  })

  it('识别树总览路由', () => {
    expect(parseRoute('#/t/abc')).toEqual({ kind: 'tree', nodeId: 'abc' })
  })

  it('识别设置路由', () => {
    expect(parseRoute('#/settings')).toEqual({ kind: 'settings' })
  })

  it('无法识别的 hash 退回主题列表', () => {
    expect(parseRoute('#/unknown/x')).toEqual({ kind: 'topics' })
  })
})

describe('routeToHash', () => {
  it('与 parseRoute 互为逆运算', () => {
    const routes = [
      { kind: 'topics' as const },
      { kind: 'node' as const, nodeId: 'abc' },
      { kind: 'tree' as const, nodeId: 'abc' },
      { kind: 'settings' as const },
    ]
    routes.forEach((route) => expect(parseRoute(routeToHash(route))).toEqual(route))
  })
})
