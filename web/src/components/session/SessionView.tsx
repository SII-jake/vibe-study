import clsx from 'clsx'
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useIsMobile } from '../../app/viewport.js'
import { useTranslate } from '../../i18n/index.js'
import {
  planAsk,
  planGoBack,
  planJumpTo,
  planPlaceChild,
  planPromote,
  type PaneView,
} from '../../services/chat/paneState.js'
import { laneAncestors, rootedConversation } from '../../services/chat/rootedConversation.js'
import { laneTitle } from '../../services/chat/laneTitle.js'
import { askAt } from '../../services/chat/store.js'
import {
  computeTrack,
  paneWidths,
  ratioFromPointer,
  routeTrack,
} from '../../services/chat/trackView.js'
import type { Session } from '../../services/chat/types.js'
import { setPaneRatio, useSettings } from '../../services/settings.js'
import { ChatInput } from '../chatInput/ChatInput.js'
import { MessageList } from '../messages/MessageList.js'
import { AskActionBar } from '../messages/AskActionBar.js'
import { buildAskTree, hasAskBranches } from '../messages/askTree.js'
import { IconAskTreeOutline20, IconBackOutline20 } from '../base/icons.js'
import { IconButton } from '../base/IconButton.js'
import { AskPane } from './AskPane.js'
import { AskSheet } from './AskSheet.js'
import { AskTreePanel } from './AskTreePanel.js'
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
  // 追问层的标题行内容（真机反馈①）：lane 根的追问标题（ask.title，模型生成
  // 见 store 流式收尾）→ 无标题时剥出问题本体 → 兜底主线标题。
  // pane 在下方声明，这里只准备纯函数。
  const [askSelection, setAskSelection] = useState<AskSelection | null>(null)
  // 输入浮层的开合与暂存的选区分开管理：操作条→浮层是两步，关闭浮层二段式都清
  const [asking, setAsking] = useState(false)
  const askingRef = useRef(false)
  askingRef.current = asking
  // 追问树面板（decisions/2026-11-25-ask-tree-navigator.md）：追问一多只能沿
  // 引子卡逐层进出，找不回之前的分支；面板摊开整棵树、标出当前位置、点即跳转。
  const [askTreeOpen, setAskTreeOpen] = useState(false)
  // 返回键分层要同步读"面板是否开着"，事件回调闭包里拿不到最新 state
  const askTreeOpenRef = useRef(false)
  askTreeOpenRef.current = askTreeOpen
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
  // 两个 lane 各自的标题（真机反馈①③ + 2026-11-22）：口径同源，取该 lane 根
  // 追问的 ask.title，未生成时回退提问本体，主线根层即会话标题。
  const headerTitle = laneTitle(session, pane.centerNodeId, title)
  const rightTitle = laneTitle(session, pane.rightNodeId, title)
  // 追问树按需派生（面板用来浏览与跳转）；流式期间正文每次更新都重建代价高，
  // 故只在面板打开时才计算，且随 session 变化重算。
  const askTree = useMemo(
    () => (askTreeOpen ? buildAskTree(session, title) : null),
    [askTreeOpen, session, title],
  )
  // 入口判据比建树便宜得多：有任意一条追问分支才显示「追问树」
  const hasAsks = useMemo(() => hasAskBranches(session), [session])
  useEffect(() => {
    setPane({ centerNodeId: sessionRootId, rightNodeId: null })
    setAsking(false)
    setAskSelection(null)
    setReturnAnchor(null)
    setAskTreeOpen(false)
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
      // 面板开着时返回键只收面板，不退层（否则一次按键掉两级，
      // 与"叠放只关最上层"的弹层惯例一致）
      if (askTreeOpenRef.current) {
        event.preventDefault()
        setAskTreeOpen(false)
        return
      }
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

  // 舞台宽度必须实测容器，不能用 window.innerWidth——后者含侧栏占位，
  // 比真实内容区多出整整一个侧栏宽，末格（右栏）因此被算宽、右边内容被裁
  // （真机反馈 2026-11-22②③）。ResizeObserver 跟随侧栏展开/收起。
  const [stageWidth, setStageWidth] = useState(0)
  useEffect(() => {
    const element = containerRef.current
    if (!element) return
    const measure = () => setStageWidth(element.clientWidth)
    measure()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure)
      return () => window.removeEventListener('resize', measure)
    }
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const paneRatio = useSettings((state) => state.paneRatio)
  // 首帧尚未测量时按窗口宽兜底，测完立即被真实值覆盖（不留空白闪一下）
  const viewportWidth = stageWidth > 0 ? stageWidth : window.innerWidth
  const { centerWidth } = paneWidths(viewportWidth, paneRatio)

  /** 拖分栏：按下后按指针横向位置换比例，抬起解绑（比例落盘下次沿用）。 */
  const onGutterDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const element = containerRef.current
    if (!element) return
    event.preventDefault()
    const rect = element.getBoundingClientRect()
    const move = (moveEvent: PointerEvent) => {
      setPaneRatio(ratioFromPointer(rect.left, rect.width, moveEvent.clientX))
    }
    const stop = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
  }
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
    // 起草期间右栏让位给起草位（§二.3 planAsk 中栏选文「右栏切起草态」）：
    // pane.rightNodeId 保持不动，取消起草后原子对话原位回位，但末格必须是起草位，
    // 否则旧子对话格占着右栏、AskPane 无处渲染（用户 2026-11-25 报的网页版 bug）。
    Boolean(desktopDraft),
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
  // getVisibleMessages 已在挂载点截断）。「返回上一级」不在这里——它属于标题行
  // （真机反馈 2026-11-22：曾作为 lane 内独立浮动条另占一块空间，与手机端不同构）。
  const renderConversationLane = (laneNodeId: string, side: 'main' | 'right') => {
    const laneSession = rootedConversation(session, laneNodeId)
    if (!laneSession) return null
    return (
      <MessageList
        session={laneSession}
        streaming={streaming}
        footer={laneFooter(laneNodeId)}
        onChildOpen={(nodeId) => openChild(nodeId, side)}
        returnAnchor={returnAnchor}
        laneRootId={laneNodeId === sessionRootId ? undefined : laneNodeId}
      />
    )
  }

  return (
    <div ref={containerRef} className={styles.view}>
      {isMobile ? (
        <MobileHeader
          title={headerTitle}
          start={
            <>
              {/* 手机端标题行用图标：向左箭头是通用返回语义，把文字位置让给标题。
                  触控目标与菜单/新对话同规格（44px），不因换图标而变小。 */}
              {pane.centerNodeId !== sessionRootId ? (
                <IconButton
                  size="xl"
                  tone="primary"
                  icon={<IconBackOutline20 />}
                  aria-label="返回上一级"
                  onClick={goBack}
                />
              ) : null}
              {hasAsks ? (
                <IconButton
                  size="xl"
                  tone="primary"
                  icon={<IconAskTreeOutline20 />}
                  aria-label="查看追问树"
                  onClick={() => setAskTreeOpen(true)}
                />
              ) : null}
            </>
          }
        />
      ) : (
        <div className={styles.header} data-session-header>
          <div className={clsx(styles.title, siderCollapsed && styles.withCollapsedSider)}>
            {title}
          </div>
          {/* 与手机端同构：中栏离主线根时，「返回上一级」进标题行与标题同行，
              不再作为 lane 内一条独立浮动条另占空间。放标题右侧——左侧留给
              侧栏收起后的两个按钮（.withCollapsedSider 的 113px 偏移）。 */}
          {centerPath.length > 1 ? (
            <button type="button" className={styles.headerBack} onClick={goBack}>
              返回上一级
            </button>
          ) : null}
          {/* 追问树入口（decisions/2026-11-25-ask-tree-navigator.md）：与「返回上一级」
              并排。桌面空间充足，用文字更清楚；无追问时没有树可看，不渲染入口。 */}
          {hasAsks ? (
            <button
              type="button"
              className={styles.headerBack}
              onClick={() => setAskTreeOpen(true)}
            >
              追问树
            </button>
          ) : null}
          {/* 右栏子对话控件：原本是右栏 lane 内一条 44px 顶栏，把右栏内容整体
              压低一条工具栏的高度、与中栏错开（真机反馈 2026-11-22）。移进标题行
              右端后右栏 lane 首个子元素直接是消息列表，两栏内容自然顶对齐。 */}
          {/* 起草期间右栏是起草位，子对话此刻不在眼前——控件跟着让位。否则「设为当前」
              会把一块看不见的对话升进中栏，用户无从理解发生了什么。pane.rightNodeId
              原地保留，取消起草后控件随子对话一起回位。 */}
          {rightSession && !desktopDraft ? (
            <div className={styles.headerRight} data-right-controls>
              <span className={styles.headerRightLabel}>{rightTitle}</span>
              <button
                type="button"
                className={styles.headerAction}
                onClick={() => setPane((p) => planPromote(p))}
              >
                设为当前
              </button>
              <button
                type="button"
                className={styles.headerActionClose}
                aria-label="关闭"
                onClick={() => {
                  setPane((p) => ({ ...p, rightNodeId: null }))
                  setReturnAnchor(null)
                }}
              >
                ✕
              </button>
            </div>
          ) : null}
        </div>
      )}
      {desktopTrack || isMobile ? (
        <TrackStage
          lanes={isMobile ? mobileLanes : lanes}
          centerWidth={centerWidth}
          viewportWidth={viewportWidth}
          singlePane={isMobile}
          gutterAt={desktopTrack ? centerWidth : undefined}
          onGutterDrag={onGutterDrag}
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
      {/* 追问树面板（decisions/2026-11-25-ask-tree-navigator.md §三）：点节点即跳转，
          目标进中栏（planJumpTo）——手机端单格视口自然退化成整屏下潜。
          currentId 取中栏节点；它未必是 lane 根，交给 askTreePath 归一即可。 */}
      {askTreeOpen && askTree ? (
        <AskTreePanel
          tree={askTree}
          currentId={pane.centerNodeId}
          onJump={(nodeId) => {
            setPane((p) => planJumpTo(p, nodeId))
            setReturnAnchor(null)
          }}
          onClose={() => setAskTreeOpen(false)}
        />
      ) : null}
    </div>
  )
}
