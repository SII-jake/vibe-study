import clsx from 'clsx'
import { useEffect, useRef, useState } from 'react'
import { useIsMobile } from '../../app/viewport.js'
import { useTranslate } from '../../i18n/index.js'
import {
  planAsk,
  planGoBack,
  planPlaceChild,
  planPromote,
  type PaneView,
} from '../../services/chat/paneState.js'
import { laneAncestors, rootedConversation } from '../../services/chat/rootedConversation.js'
import { askAt } from '../../services/chat/store.js'
import { computeTrack, routeTrack } from '../../services/chat/trackView.js'
import type { Session } from '../../services/chat/types.js'
import { ChatInput } from '../chatInput/ChatInput.js'
import { MessageList } from '../messages/MessageList.js'
import { AskActionBar } from '../messages/AskActionBar.js'
import { AskPane } from './AskPane.js'
import { AskSheet } from './AskSheet.js'
import { installContextMenuGuard } from './contextMenuGuard.js'
import { MobileHeader } from './MobileHeader.js'
import { readAskSelection, type AskSelection } from './readAskSelection.js'
import { TrackStage } from './TrackStage.js'
import styles from './SessionView.module.css'

/** 会话页：标题栏（移动端为顶栏）+ 消息列表，输入框吸底 */
export const SessionView = ({
  session,
  streaming,
  siderCollapsed,
}: {
  session: Session
  streaming: boolean
  siderCollapsed: boolean
}) => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const title = session.title || t('untitledChat')
  const [askSelection, setAskSelection] = useState<AskSelection | null>(null)
  // 输入浮层的开合与暂存的选区分开管理：操作条→浮层是两步，关闭浮层二段式都清
  const [asking, setAsking] = useState(false)
  const askingRef = useRef(false)
  askingRef.current = asking
  // 双栏视口状态（decisions/2026-11-19 §二.3）：centerNodeId 恒为会话主线根
  // centerNodeId 是 lane 链的当前中栏节点；祖先链与右栏由四条 pane 规则唯一驱动。
  // rightNodeId 由四条 pane 规则唯一驱动——起草占位、子对话位、promote/goBack。
  const [pane, setPane] = useState<PaneView>(() => ({
    centerNodeId: session.rootMessageId ?? null,
    rightNodeId: null,
  }))
  // 「返回到这里」高亮的来源锚点（§二.5 第三轮修订）：记 anchorMessageId
  // 限定注入哪条消息 + anchorText 由渲染层内联标记；placeChild/openChild
  // 发起时侧记，goBack 重记为留在右栏 lane 的来源锚点；✕/切会话清空。
  const [returnAnchor, setReturnAnchor] = useState<{
    anchorMessageId: string
    anchorText: string
  } | null>(null)
  // 切换会话时 pane 跟随新主线重根
  const sessionRootId = session.rootMessageId ?? null
  useEffect(() => {
    setPane({ centerNodeId: sessionRootId, rightNodeId: null })
    setAsking(false)
    setAskSelection(null)
    setReturnAnchor(null)
  }, [session.id, sessionRootId])
  // 桌面起草时中栏宽度的量取锚点；clientWidth 在挂载后才有值
  const containerRef = useRef<HTMLDivElement>(null)
  // 长按区内的系统 contextmenu 不启动（配合壳 finish 拦截，防系统框"一闪而过"替身）
  useEffect(() => installContextMenuGuard(), [])

  // 系统返回键分层（decisions/2026-11-19 §三.1）：壳按返回键时向前端发 'vite-back'
  // 自定义事件。有追问层开着（centerNodeId 非主线根）时本组件接住——消费事件
  // （preventDefault，壳得到信号不再走系统默认）并退一层；主线根层保持不消费，
  // 壳按系统默认动作（退应用/上一页历史）。
  useEffect(() => {
    const onBackKey = (event: Event) => {
      setPane((current) => {
        if (current.centerNodeId !== null && current.centerNodeId !== sessionRootId) {
          event.preventDefault()
          // vite-back 挂在 document，goBack 里再读 centerPath 时机太晚——
          // 直接以 pane 状态驱动：祖先链由 laneAncestors 派生，本 effect 依赖
          // 闭包里的 session；把 centerNodeId 挪到 lane 祖先链的上一格
          const path = laneAncestors(session, current.centerNodeId)
          const parentNodeId = path.length > 1 ? path.at(-2)! : (sessionRootId ?? null)
          return planGoBack(current, parentNodeId)
        }
        return current
      })
    }
    document.addEventListener('vite-back', onBackKey)
    return () => document.removeEventListener('vite-back', onBackKey)
  }, [session, sessionRootId, isMobile])

  // 壳侧同步（选型守护同款模式）：把"当前是否还有层可退"实时同步给原生壳——
  // 壳按返回键时只需同步读这一眼决定分叉（有层 → 发 vite-back 事件；无层 → 退应用）。
  // 不回流任何交互事件到原生，只读暴露一个布尔状态；纯浏览器环境桥不存在时静默跳过。
  useEffect(() => {
    const hasLayer = pane.centerNodeId !== null && pane.centerNodeId !== sessionRootId
    ;(window as { VibeBackKey?: { setHasLayer(h: boolean): void } }).VibeBackKey?.setHasLayer(hasLayer)
  }, [pane.centerNodeId, sessionRootId])

  // 选择追问入口（移动端实测重塑）：
  // 选择变化只写入防抖——长按后会紧跟一连串 selectionchange（拖选手柄的轨迹），
  // 停顿 350ms 才亮操作条，避免遮罩在拖选中途盖住手柄导致无法扩选。
  // 浮层出现期间选区必然变化（焦点移动），askingRef 挡住它回写/清空操作条。
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const onSelectionChange = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        if (askingRef.current) return
        const selection = window.getSelection()
        if (!selection) {
          setAskSelection(null)
          return
        }
        const captured = readAskSelection(selection)
        if (!captured) {
          setAskSelection(null)
          return
        }
        // 读矩形时机必须在"停顿"判定之后——拖选中 range.getBoundingClientRect 会随手柄轨迹变，
        // 只有在停顿的那一刻取快照，操作条位置才稳。
        const rect =
          selection.rangeCount > 0 ? selection.getRangeAt(0).getBoundingClientRect() : null
        if (!rect || (rect.width === 0 && rect.height === 0)) {
          setAskSelection(null)
          return
        }
        setAskSelection({ ...captured, rect })
      }, 350)
    }
    document.addEventListener('selectionchange', onSelectionChange)
    return () => {
      document.removeEventListener('selectionchange', onSelectionChange)
      if (timer) clearTimeout(timer)
    }
  }, [])

  const centerWidth = Math.floor((containerRef.current?.clientWidth ?? window.innerWidth) / 2)
  const viewportWidth = window.innerWidth
  // 起草位：桌面 + 有选区 + 处于提问输入中
  const desktopDraft = !isMobile && askSelection && asking
  // 右栏子对话位：有 rightNodeId 时从会话派生该分支根起的可见链
  const rightRoot = pane.rightNodeId ? rootedConversation(session, pane.rightNodeId) : null
  const rightSession = pane.rightNodeId && rightRoot ? rightRoot : null
  // 轨道激活（§二.1 视口永框最后两格的桌面常态）：pane 状态非默认即铺轨——
  // 起草中、右栏有子对话、或中栏已下潜离主线根（嵌套/promote/goBack 之后）。
  // 默认态（主线根 + 无右栏 + 不起草）保持单栏，不引入多余布局。
  const desktopTrack =
    !isMobile && (desktopDraft || pane.rightNodeId !== null || pane.centerNodeId !== sessionRootId)
  // lane 序列纯计算（§二.1 + 附录）：从 centerNodeId 沿 ask 锚点爬回主线根，
  // 再加右栏（子对话位或草稿占位）。pane 状态只存两个节点 id，链不另存。
  const centerPath = laneAncestors(session, pane.centerNodeId)
  const lanes = computeTrack(
    centerPath.length > 0 ? centerPath : sessionRootId ? [sessionRootId] : [],
    pane.rightNodeId,
  )
  // 手机端恒走 TrackStage（真机反馈修复⑤——曾有 mobileTrack 根态回落分支：
  // 主线根时撤下 TrackStage 走裸 MessageList，提交瞬间"挂载即平移"无滑动过程；
  // 恒走轨道后 lanes 1→2 与 offset 0→-屏宽在同一 .track 元素上发生，transition 生效）。
  const mobileLanes = routeTrack(
    centerPath.length > 0 ? centerPath : sessionRootId ? [sessionRootId] : [],
  )
  // 点分支卡（§二.5）：卡与下划线同路径——子对话进右栏。
  // 卡在右栏时先沉右栏入中栏（planPlaceChild 的 'right' 分支，连续下潜）。
  const openChild = (nodeId: string, side: 'main' | 'right') => {
    // 侧记来源锚点：返回父层时来源片段带「返回到这里」内联高亮（§二.5）
    const child = session.messages.find((m) => m.id === nodeId)
    const childAsk = child?.role === 'user' ? child.ask : undefined
    setReturnAnchor(
      childAsk ? { anchorMessageId: childAsk.anchorMessageId, anchorText: childAsk.anchorText } : null,
    )
    // 手机端（§三.1 单格轨道）：点卡与提交即导航同语义——整屏下潜到子 lane，
    // 不存在右栏；placeChild 的 right 栏分流只在桌面成立。
    if (isMobile) {
      setPane((p) => ({ ...p, centerNodeId: nodeId }))
      return
    }
    setPane((p) => planPlaceChild(p, nodeId, side))
  }
  // 返回上一级（planGoBack）：中栏的父 lane 根即祖先链倒数第二格；无父级不变
  const goBack = () => {
    // 被留在右栏的是当前中栏——返回后高亮落在它的来源锚点上（§二.5）
    const current = session.messages.find((m) => m.id === pane.centerNodeId)
    const currentAsk = current?.role === 'user' ? current.ask : undefined
    setReturnAnchor(
      currentAsk ? { anchorMessageId: currentAsk.anchorMessageId, anchorText: currentAsk.anchorText } : null,
    )
    setPane((p) => planGoBack(p, centerPath.at(-2) ?? null))
  }

  // lane 内发送的挂载点（真机反馈③）：追问层里直接发送的消息挂该层可见
  // 链尾，不能落回主线——sendMessage 的 laneRootId 按所在 lane 根传入。
  // 主线 lane（laneNodeId === sessionRootId）恒走旧口径挂主线尾。
  const laneFooter = (laneNodeId: string) => (
    <div className={styles.inputContainer}>
      <ChatInput
        sessionId={session.id}
        laneRootId={laneNodeId === sessionRootId ? undefined : laneNodeId}
      />
    </div>
  )

  // 单 lane 内容：以该 lane 根消息重根的可见链（追问的问答不占父 lane 正文，
  // getVisibleMessages 已在挂载点截断）。中栏非主线根时顶栏带"返回上一级"。
  const renderConversationLane = (laneNodeId: string, side: 'main' | 'right') => {
    const laneSession = rootedConversation(session, laneNodeId)
    if (!laneSession) return null
    const isCenter = laneNodeId === pane.centerNodeId
    return (
      <>
        {isCenter && centerPath.length > 1 ? (
          <div className={styles.laneHeader} data-center-header>
            <button type="button" onClick={goBack}>
              返回上一级
            </button>
          </div>
        ) : null}
        <MessageList
          session={laneSession}
          streaming={streaming}
          footer={laneFooter(laneNodeId)}
          onChildOpen={(nodeId) => openChild(nodeId, side)}
          returnAnchor={returnAnchor}
        />
      </>
    )
  }

  return (
    <div ref={containerRef} className={styles.view}>
      {isMobile ? (
        <MobileHeader title={title} />
      ) : (
        <div className={styles.header}>
          <div className={clsx(styles.title, siderCollapsed && styles.withCollapsedSider)}>
            {title}
          </div>
        </div>
      )}
      {desktopTrack || isMobile ? (
        <TrackStage
          lanes={isMobile ? mobileLanes : lanes}
          centerWidth={centerWidth}
          viewportWidth={viewportWidth}
          singlePane={isMobile}
          renderLane={(lane) => {
            // 手机端整屏下潜（§三）：lane 即路由链上一层对话；视口钉末格 =
            // 用户看到的那层问答，父层随轨道留屏外（返回=右移一格找回）
            if (isMobile) {
              return lane.nodeId ? renderConversationLane(lane.nodeId, 'main') : null
            }
            // 右栏子对话位：lane 命中 rightNodeId（§二.4 顶栏 + 消息流）
            if (pane.rightNodeId !== null && lane.nodeId === pane.rightNodeId) {
              return rightSession ? (
                <div data-right-pane>
                  <div data-right-header>
                    <span>子对话</span>
                    <button type="button" onClick={() => setPane((p) => planPromote(p))}>
                      设为当前
                    </button>
                    <button
                      type="button"
                      aria-label="关闭"
                      onClick={() => {
                                                setPane((p) => ({ ...p, rightNodeId: null }))
                        setReturnAnchor(null)
                      }}
                    >
                      ✕
                    </button>
                  </div>
                  <MessageList
                    session={rightSession}
                    streaming={streaming}
                    footer={laneFooter(pane.rightNodeId ?? '')}
                    onChildOpen={(nodeId) => openChild(nodeId, 'right')}
                            />
                </div>
              ) : null
            }
            // 草稿占位格（§二.4 起草位三态）：起草中 = AskPane；无起草 = 空态
            if (lane.relation === 'draft') {
              return desktopDraft ? (
              <AskPane
                // draft lane 只在 desktopDraft=true 时铺出（其条件含 askSelection 非空）；
                // renderLane 闭包跨回调捕获，TS 无法沿路以外条件收窄——契约上非空
                anchorText={askSelection!.anchorText}
                onSubmit={(question) => {
                  // 提交即发起追问；askAt 校验失败（false）时不清状态，起草位保留
                  const branchRootId = askAt(
                    session.id,
                    askSelection!.anchorMessageId,
                    askSelection!.anchorText,
                    question,
                    askSelection!.fragmentIndex,
                  )
                  if (branchRootId === false) {
                    return
                  }
                  // placeChild（§二.3）：新子对话一律进右栏。
                  // 发起栏为右栏时其内容已先于起草沉入中栏（onAsk 的 planAsk），
                  // 故提交恒以中栏侧进位。
                  setPane((p) => planPlaceChild(p, branchRootId, 'main'))
                  setAsking(false)
                  setAskSelection(null)
                }}
                onCancel={() => {
                  setAsking(false)
                  setAskSelection(null)
                }}
              />
              ) : (
                <div className={styles.draftEmpty} data-draft-empty>
                  选中一段文字，就能在这里开一条新的追问
                </div>
              )
            }
            // 祖先/中栏对话格
            return lane.nodeId ? renderConversationLane(lane.nodeId, 'main') : null
          }}
        />
      ) : (
        <MessageList
          session={session}
          streaming={streaming}
          footer={laneFooter(sessionRootId ?? '')}
          onChildOpen={(nodeId) => openChild(nodeId, 'main')}
        />
      )}
      {askSelection && !asking ? (
        <AskActionBar
          anchorText={askSelection.anchorText}
          rect={askSelection.rect}
          onAsk={() => {
            // planAsk（§二.3）：中栏选文两栏不动、右栏切起草；右栏选文右栏先沉中栏
            const side = askSelection.pane ?? 'main'
            if (side === 'right') {
              setPane((p) => planAsk(p, 'right'))
            }
            setAsking(true)
          }}
          onCopied={() => {
            window.getSelection()?.removeAllRanges()
            setAskSelection(null)
          }}
        />
      ) : null}
      {// 手机端 AskSheet 底部弹层（§三.2）：单格视口无可见起草位，以弹层承接
      // planAsk 的起草语义；提交即导航（新 lane 生成 + 视口钉末格）。
      askSelection && asking && isMobile ? (
        <AskSheet
          anchorText={askSelection.anchorText}
          onSubmit={(question) => {
            // 提交即导航（§三.3）：建子分支 → 立刻整屏下潜到该子对话层。
            // 手机端 placeChild 的退化形态：不弹右栏，centerNodeId 直接移到子分支根，
            // routeTrack 视口恒钉末格，用户看到新 lane 的流式回答；父层随轨道留屏外。
            const branchRootId = askAt(
              session.id,
              askSelection.anchorMessageId,
              askSelection.anchorText,
              question,
              askSelection.fragmentIndex,
            )
            if (branchRootId !== false) {
              setPane((p) => ({ ...p, centerNodeId: branchRootId }))
            }
            setAsking(false)
            setAskSelection(null)
          }}
          onCancel={() => {
            setAsking(false)
            setAskSelection(null)
          }}
        />
      ) : null}
    </div>
  )
}
