import { useCallback, useEffect, useRef, useState } from 'react'
import { AskPane } from '../ui/AskPane'
import { DiveSlide } from '../ui/dive-slide'
import { NodePage } from '../ui/NodePage'
import { RightPane } from '../ui/right-pane'
import { SessionList } from '../ui/SessionList'
import { SettingsPage } from '../ui/SettingsPage'
import { StartPage } from '../ui/StartPage'
import { TreePage } from '../ui/TreePage'
import { toAskInput } from '../ui/ask-target'
import { usePaneWidth } from '../ui/use-pane-width'
import type { SelectionReading } from '../ui/selection'
import { breadcrumb } from '../domain/tree'
import { type PaneSide, type PaneView, planAsk, planPlaceChild, planPromote } from './pane-state'
import { parseRoute, type Route, routeToHash } from './route'
import { useLearnData } from './store'

interface PendingAsk {
  /** 提问要挂在哪个节点上（父节点）；恒等于位移完成后的中栏节点 */
  nodeId: string
  reading: SelectionReading
}

/** 一次「中栏 + 右栏」的整体位移，随导航一起生效。 */
interface DiveIntent {
  centerNodeId: string
  rightNodeId: string | null
  pendingAsk: PendingAsk | null
}

/**
 * 桌面为三栏：会话栏 | 中栏（父级对话） | 右栏（子级对话）。
 * 问答是一棵树，两栏始终展示相邻两代。
 * 选中一段并点「就这段提问」就等于新增一个子结点，位移发生在那一刻：
 * - 从中栏发起：中栏父对话不动，右栏展开新问答
 * - 从右栏发起：当前右栏本身就是父级，于是它立刻升入中栏，右栏让给新问答
 * 提交后新节点落到右栏，继续可读、可继续追问。
 *
 * TODO(mobile): 手机端交互暂关闭，后续单独设计。当前只按桌面三栏布局工作。
 */
export function App() {
  const data = useLearnData()
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash))
  const [pendingAsk, setPendingAsk] = useState<PendingAsk | null>(null)
  /** 右栏正在读的子对话；与 pendingAsk 互斥，同一时刻只出现一个 */
  const [rightNodeId, setRightNodeId] = useState<string | null>(null)
  /** 中心和右栏要一起变，用它告诉 route 副作用这次别清空右栏 */
  const diveRef = useRef<DiveIntent | null>(null)
  /** 右栏是否仍占着一个轨道：由过渡组件回调，离场动画播完才变 false */
  const [rightVisible, setRightVisible] = useState(false)
  /** 可拖分隔条：右栏宽度由用户拖动决定（向左拖变宽、向右拖变窄） */
  const [paneWidth, paneDragging, startPaneDrag] = usePaneWidth({
    initial: 360,
    min: 240,
    max: 640,
  })

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

  const openNode = useCallback(
    (nodeId: string) => {
      // 用户手动切换对话：右栏没有需要保留的子对话
      diveRef.current = null
      navigate({ kind: 'node', nodeId })
    },
    [navigate],
  )

  // 换节点/换页面时收起右栏，避免问题挂到别的节点上；下潜时则按预定安排还原右栏。
  // 这里不消费 diveRef，StrictMode 下重复执行也得到同一结果。
  useEffect(() => {
    setPendingAsk(null)
    const dive = diveRef.current
    if (dive && route.kind === 'node' && route.nodeId === dive.centerNodeId) {
      setRightNodeId(dive.rightNodeId)
      setPendingAsk(dive.pendingAsk)
      return
    }
    setRightNodeId(null)
  }, [route])

  /** 中栏与右栏一起变：把右栏内容升入中栏，右栏交给新的子对话。 */
  const diveTo = useCallback(
    (centerNodeId: string, nextRightNodeId: string | null, nextPendingAsk: PendingAsk | null) => {
      diveRef.current = { centerNodeId, rightNodeId: nextRightNodeId, pendingAsk: nextPendingAsk }
      setRightNodeId(nextRightNodeId)
      setPendingAsk(nextPendingAsk)
      navigate({ kind: 'node', nodeId: centerNodeId })
    },
    [navigate],
  )

  const centerNodeId = route.kind === 'node' ? route.nodeId : null

  /** 子对话落位的唯一入口：中栏发起只进右栏，右栏发起则先下潜。 */
  const placeChild = useCallback(
    (childId: string, pane: PaneSide) => {
      const view: PaneView = { centerNodeId, rightNodeId }
      const next = planPlaceChild(view, childId, pane)
      if (next.centerNodeId && next.centerNodeId !== centerNodeId) {
        diveTo(next.centerNodeId, next.rightNodeId, null)
        return
      }
      setRightNodeId(next.rightNodeId)
    },
    [centerNodeId, rightNodeId, diveTo],
  )

  /**
   * 点「就这段提问」= 树上新增一个子结点，位移就在此刻发生：
   * 在右栏发起时，当前右栏升入中栏，右栏让给这条新问答。
   */
  const beginAsk = useCallback(
    (nodeId: string, reading: SelectionReading, pane: PaneSide) => {
      const view: PaneView = { centerNodeId, rightNodeId }
      const next = planAsk(view, pane)
      const ask: PendingAsk = { nodeId: next.centerNodeId ?? nodeId, reading }

      if (next.centerNodeId && next.centerNodeId !== centerNodeId) {
        diveTo(next.centerNodeId, null, ask)
        return
      }
      setRightNodeId(next.rightNodeId)
      setPendingAsk(ask)
    },
    [centerNodeId, rightNodeId, diveTo],
  )

  const submitPendingAsk = useCallback(
    (question: string) => {
      if (!pendingAsk) return
      const node = data.nodes.find((item) => item.id === pendingAsk.nodeId)
      if (!node) return
      const input = toAskInput(node, pendingAsk.reading, question)
      setPendingAsk(null)
      // 位移已在 beginAsk 完成：父级在中栏，新子结点落到右栏
      setRightNodeId(data.askAt(input))
    },
    [data, pendingAsk],
  )

  const activeRootId =
    route.kind === 'node'
      ? (breadcrumb(data.nodes, route.nodeId)[0]?.id ?? null)
      : null

  const rightNode = rightNodeId ? data.nodes.find((item) => item.id === rightNodeId) ?? null : null
  const rightOpen = route.kind === 'node' && (pendingAsk !== null || rightNode !== null)

  const sidebar = (
    <SessionList
      data={data}
      activeRootId={activeRootId}
      onOpen={openNode}
      onNewSession={() => navigate({ kind: 'topics' })}
      onOpenSettings={() => navigate({ kind: 'settings' })}
    />
  )

  return (
    <div
      className={`app-shell ${rightVisible ? 'has-right' : ''}`}
      data-dragging={paneDragging ? '' : undefined}
      style={
        rightVisible
          ? ({ gridTemplateColumns: `320px minmax(0, 1fr) ${paneWidth}px` } as React.CSSProperties)
          : undefined
      }
    >
      {/* TODO(mobile): 手机端的抽屉入口暂时关闭，后续单独设计手机交互 */}
      <aside className="app-sidebar">{sidebar}</aside>

      <DiveSlide
        className="app-main"
        trigger={centerNodeId}
      >
        {route.kind === 'topics' && (
          <StartPage data={data} onCreated={openNode} />
        )}

        {route.kind === 'node' && (
          <NodePage
            data={data}
            nodeId={route.nodeId}
            onNavigate={openNode}
            onOpenTree={(nodeId) => navigate({ kind: 'tree', nodeId })}
            onRequestAsk={(reading) => beginAsk(route.nodeId, reading, 'main')}
            onOpenBranch={(id) => placeChild(id, 'main')}
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
      </DiveSlide>

      <RightPane
        open={rightOpen}
        onVisibilityChange={setRightVisible}
      >
        <div
          className={`pane-divider ${paneDragging ? 'pane-divider-required' : ''}`}
          role="separator"
          aria-orientation="vertical"
          aria-label="调整右栏宽度"
          onPointerDown={startPaneDrag}
        />
        <header className="right-head">
          <span className="right-label">{pendingAsk ? '新分支' : '子对话'}</span>
          <div className="right-actions">
            {rightNode && (
              <button
                type="button"
                className="btn-ghost right-promote"
                title="把这条子对话设为中栏当前对话"
                onClick={() => {
                  const next = planPromote({ centerNodeId, rightNodeId })
                  diveRef.current = null
                  setRightNodeId(next.rightNodeId)
                  if (next.centerNodeId) navigate({ kind: 'node', nodeId: next.centerNodeId })
                }}
              >
                设为当前
              </button>
            )}
            <button
              type="button"
              className="icon-btn"
              onClick={() => {
                setPendingAsk(null)
                setRightNodeId(null)
              }}
              aria-label="收起右栏"
            >
              ✕
            </button>
          </div>
        </header>

        {pendingAsk ? (
          <AskPane
            anchorText={pendingAsk.reading.text}
            onSubmit={submitPendingAsk}
            onCancel={() => setPendingAsk(null)}
          />
        ) : (
          rightNode && (
            <NodePage
              data={data}
              nodeId={rightNode.id}
              onNavigate={openNode}
              onOpenTree={(nodeId) => navigate({ kind: 'tree', nodeId })}
              onRequestAsk={(reading) => beginAsk(rightNode.id, reading, 'right')}
              onOpenBranch={(id) => placeChild(id, 'right')}
              compact
            />
          )
        )}
      </RightPane>

      {data.error && (
        <div className="toast" role="alert" onClick={data.clearError}>
          {data.error}
        </div>
      )}
    </div>
  )
}
