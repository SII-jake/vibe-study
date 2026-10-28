import { useEffect, useRef, type ReactNode } from 'react'

export interface DiveSlideProps {
  /**
   * 位移触发值：变化时发起平滑过渡；null 表示当前没有对话（不播）。
   * 现在接的是中栏节点 id —— 右栏升入中栏必然使它变化。
   */
  trigger: string | null
  children: ReactNode
  className?: string
  onPointerEnter?(): void
  onPointerLeave?(): void
}

const SLIDE_MS = 420
const EASE = 'cubic-bezier(0.22, 0.61, 0.36, 1)'

/**
 * 「右栏升入中栏」的过渡容器。
 * 触发值变化时：旧 DOM 克隆成快照向左滑出，新内容从右侧同时滑入，
 * 视觉上像轨道整体左移一格，而不是整页瞬间替换。
 */
export function DiveSlide({
  trigger,
  children,
  className,
  onPointerEnter,
  onPointerLeave,
}: DiveSlideProps) {
  const layerRef = useRef<HTMLElement>(null)
  const liveRef = useRef<HTMLDivElement>(null)
  const prevTriggerRef = useRef<string | null>(trigger)
  const lastNodesRef = useRef<Node[] | null>(null)

  /**
   * 下面两个 effect 的顺序有语义：过渡必须先用「上一次提交存档的快照」，
   * 然后捕获 effect 才把当前 DOM 存档；颠倒顺序会让快照变成新内容、动画失效。
   */
  useEffect(() => {
    if (trigger === prevTriggerRef.current) return
    prevTriggerRef.current = trigger
    if (trigger === null) return

    const layer = layerRef.current
    const live = liveRef.current
    const previous = lastNodesRef.current
    if (!layer || !live || !previous || previous.length === 0) return
    if (typeof Element.prototype.animate !== 'function') return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    // 连续快速下潜时，先清掉上一次没播完的快照
    layer.querySelectorAll('.dive-snapshot').forEach((el) => el.remove())

    const snapshot = document.createElement('div')
    snapshot.className = 'dive-snapshot'
    snapshot.setAttribute('aria-hidden', 'true')
    snapshot.append(...previous)
    // 克隆体里的 id 与真身重复（如阅读容器），根除避免选择器串位
    snapshot.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'))

    layer.append(snapshot)

    // 复原滚动位置，新旧内容在同一阅读进度上交接
    const liveScroller = live.querySelector<HTMLElement>('.reader-body')
    const snapScroller = snapshot.querySelector<HTMLElement>('.reader-body')
    if (liveScroller && snapScroller) snapScroller.scrollTop = liveScroller.scrollTop

    const dx = Math.max(140, Math.round(layer.getBoundingClientRect().width))

    // 新内容自右滑入（欢迎来代）、旧快照向左滑出（离去的代）
    const liveAnim = live.animate(
      [
        { transform: `translateX(${dx}px)`, opacity: 0.4 },
        { transform: 'translateX(0px)', opacity: 1 },
      ],
      { duration: SLIDE_MS, easing: EASE },
    )
    const snapAnim = snapshot.animate(
      [
        { transform: 'translateX(0px)', opacity: 1 },
        { transform: `translateX(-${dx}px)`, opacity: 0 },
      ],
      { duration: SLIDE_MS, easing: EASE },
    )

    const remove = () => snapshot.remove()
    snapAnim.finished.then(remove).catch(remove)
    liveAnim.finished.catch(() => undefined)
    // 兜底清理：低端机或掉帧环境下 finished 可能不按时触发
    window.setTimeout(remove, SLIDE_MS + 200)
  }, [trigger])

  /** 每次提交后把当前 DOM 存档为下一次过渡的旧内容。 */
  useEffect(() => {
    const live = liveRef.current
    if (!live) return
    lastNodesRef.current = Array.from(live.childNodes).map((node) => node.cloneNode(true))
  })

  return (
    <main
      ref={layerRef}
      className={className ? `dive-layer ${className}` : 'dive-layer'}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
    >
      <div ref={liveRef} className="dive-live">
        {children}
      </div>
    </main>
  )
}
