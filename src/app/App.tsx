import { useCallback, useEffect, useState } from 'react'
import { NodePage } from '../ui/NodePage'
import { SettingsPage } from '../ui/SettingsPage'
import { TopicsPage } from '../ui/TopicsPage'
import { TreePage } from '../ui/TreePage'
import { parseRoute, type Route, routeToHash } from './route'
import { useLearnData } from './store'

export function App() {
  const data = useLearnData()
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash))

  useEffect(() => {
    const handler = () => setRoute(parseRoute(window.location.hash))
    window.addEventListener('hashchange', handler)
    return () => window.removeEventListener('hashchange', handler)
  }, [])

  /** 导航走 hash，手机返回键因此天然回退到上一个页面。 */
  const navigate = useCallback((next: Route) => {
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

  return (
    <>
      {route.kind === 'topics' && (
        <TopicsPage
          data={data}
          onOpen={(nodeId) => navigate({ kind: 'node', nodeId })}
          onOpenSettings={() => navigate({ kind: 'settings' })}
        />
      )}

      {route.kind === 'node' && (
        <NodePage
          data={data}
          nodeId={route.nodeId}
          onNavigate={(nodeId) => navigate({ kind: 'node', nodeId })}
          onOpenTree={(nodeId) => navigate({ kind: 'tree', nodeId })}
          onOpenTopics={() => navigate({ kind: 'topics' })}
        />
      )}

      {route.kind === 'tree' && (
        <TreePage
          data={data}
          nodeId={route.nodeId}
          onNavigate={(nodeId) => navigate({ kind: 'node', nodeId })}
          onBack={() => navigate({ kind: 'node', nodeId: route.nodeId })}
        />
      )}

      {route.kind === 'settings' && (
        <SettingsPage onBack={() => navigate({ kind: 'topics' })} />
      )}

      {data.error && (
        <div className="toast" role="alert" onClick={data.clearError}>
          {data.error}
        </div>
      )}
    </>
  )
}
