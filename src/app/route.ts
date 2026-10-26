/** 路由落在 URL hash 上，让手机返回键与浏览器后退行为一致。 */

export type Route =
  | { kind: 'topics' }
  | { kind: 'node'; nodeId: string }
  | { kind: 'tree'; nodeId: string }
  | { kind: 'settings' }

export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#/, '')
  const node = /^\/n\/([^/]+)$/.exec(path)
  if (node?.[1]) return { kind: 'node', nodeId: node[1] }
  const tree = /^\/t\/([^/]+)$/.exec(path)
  if (tree?.[1]) return { kind: 'tree', nodeId: tree[1] }
  if (path === '/settings') return { kind: 'settings' }
  return { kind: 'topics' }
}

export function routeToHash(route: Route): string {
  switch (route.kind) {
    case 'node':
      return `#/n/${route.nodeId}`
    case 'tree':
      return `#/t/${route.nodeId}`
    case 'settings':
      return '#/settings'
    default:
      return '#/'
  }
}
