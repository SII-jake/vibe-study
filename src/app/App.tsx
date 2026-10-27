import { useCallback, useEffect, useState } from 'react'
import { NodePage } from '../ui/NodePage'
import { SessionList } from '../ui/SessionList'
import { SettingsPage } from '../ui/SettingsPage'
import { TreePage } from '../ui/TreePage'
import { useMediaQuery } from '../ui/use-media-query'
import { breadcrumb } from '../domain/tree'
import { parseRoute, type Route, routeToHash } from './route'
import { useLearnData } from './store'

/** 主从式布局：桌面左侧常驻会话栏 + 右侧阅读区；手机会话栏以抽屉形式打开。 */
export function App() {
  const data = useLearnData()
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash))
  const [drawerOpen, setDrawerOpen] = useState(false)
  const isDesktop = useMediaQuery('(min-width: 768px)')

  useEffect(() => {
    const handler = () => setRoute(parseRoute(window.location.hash))
    window.addEventListener('hashchange', handler)
    return () => window.removeEventListener('hashchange', handler)
  }, [])

  /** 导航走 hash，手机返回键因此天然回退到上一个页面。 */
  const navigate = useCallback((next: Route) => {
    setDrawerOpen(false)
    const hash = routeToHash(next)
    if (window.location.hash === hash) {
      setRoute(next)
      return
    }
    window.location.hash = hash
  }, [])

  useEffect(() => {
    if (data.error) {
      const timer = window.setTimeout(() => data.clearError(), 8000)
      return () => window.clearTimeout(timer)
    }
    return undefined
  }, [data.error, data.clearError])

  const openNode = useCallback(
    (nodeId: string) => navigate({ kind: 'node', nodeId }),
    [navigate],
  )

  const activeRootId =
    route.kind === 'node'
      ? (breadcrumb(data.nodes, route.nodeId)[0]?.id ?? null)
      : null

  const sidebar = (
    <SessionList
      data={data}
      activeRootId={activeRootId}
      onOpen={openNode}
      onOpenSettings={() => navigate({ kind: 'settings' })}
    />
  )

  return (
    <div className="app-shell">
      {isDesktop && <aside className="app-sidebar">{sidebar}</aside>}

      {!isDesktop && drawerOpen && (
        <div className="drawer-backdrop" onClick={() => setDrawerOpen(false)}>
          <aside className="drawer" onClick={(event) => event.stopPropagation()}>
            {sidebar}
          </aside>
        </div>
      )}

      <main className="app-main">
        {route.kind === 'topics' && (
          <div className="empty-page">
            {!isDesktop && (
              <button type="button" className="icon-btn menu-btn" onClick={() => setDrawerOpen(true)} aria-label="会话列表">
                ☰
              </button>
            )}
            <p className="empty">从左侧选一个会话继续，或者新开一个主题。</p>
          </div>
        )}

        {route.kind === 'node' && (
          <NodePage
            data={data}
            nodeId={route.nodeId}
            onNavigate={openNode}
            onOpenTree={(nodeId) => navigate({ kind: 'tree', nodeId })}
            onOpenMenu={isDesktop ? undefined : () => setDrawerOpen(true)}
          />
        )}

        {route.kind === 'tree' && (
          <TreePage
            data={data}
            nodeId={route.nodeId}
            onNavigate={openNode}
            onBack={() => navigate({ kind: 'node', nodeId: route.nodeId })}
          />
        )}

        {route.kind === 'settings' && (
          <SettingsPage
            health={data.health}
            onRefreshHealth={data.refreshHealth}
            onBack={() =>
              navigate(
                activeRootId ? { kind: 'node', nodeId: activeRootId } : { kind: 'topics' },
              )
            }
          />
        )}
      </main>

      {data.error && (
        <div className="toast" role="alert" onClick={data.clearError}>
          {data.error}
        </div>
      )}
    </div>
  )
}
