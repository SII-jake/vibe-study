import { useEffect, useRef, useState, type ReactNode } from 'react'

export interface RightPaneProps {
  /** 是否应显示右栏 */
  open: boolean
  children: ReactNode
  /** 出现/消失结束时回调：结束才通知外层同步编排（如 grid 收窄） */
  onVisibilityChange?(visible: boolean): void
  onPointerEnter?(): void
  onPointerLeave?(): void
}

const SLIDE_MS = 320
const EASE = 'cubic-bezier(0.22, 0.61, 0.36, 1)'

function canSlide(): boolean {
  return (
    typeof Element !== 'undefined' &&
    typeof Element.prototype.animate === 'function' &&
    !(
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    )
  )
}

function slideDistance(element: HTMLElement): number {
  return Math.max(120, Math.round(element.getBoundingClientRect().width))
}

interface ExitJob {
  cancelled: boolean
  cancel(): void
}

/**
 * 右栏出现/消失的空间位移。
 * 打开：自右侧滑入；关闭：向右滑出、动画结束后才卸载。
 * 与外层 grid 收窄同时发生，是父子对话"本来相邻、只是窗口挪过去"的观感来源。
 *
 * 状态模型刻意收敛：mounted 与 open 解耦（关闭延迟卸载），prevOpen 保证
 * 一次方向转变只播放一次动画；编排 effect 只依赖 open，避免闭包身份波动
 * 把进行中离场动画误打断成永远残留。
 */
export function RightPane({
  open,
  children,
  onVisibilityChange,
  onPointerEnter,
  onPointerLeave,
}: RightPaneProps) {
  const [mounted, setMounted] = useState(open)
  const prevOpenRef = useRef(false)
  const actionRef = useRef<'idle' | 'enter' | 'exit'>('idle')
  const exitRef = useRef<ExitJob | null>(null)
  const paneRef = useRef<HTMLElement>(null)
  const contentRef = useRef<ReactNode>(children)
  const notifyRef = useRef(onVisibilityChange)

  useEffect(() => {
    notifyRef.current = onVisibilityChange
  })

  // 打开期间内容跟随；一变关闭就冻结，离场动画播的是当时的子对话
  useEffect(() => {
    if (open) contentRef.current = children
  }, [open, children])

  /** 编排：方向转变（且仅转变）时发起进/离场；其余重渲染不动。 */
  useEffect(() => {
    if (open) {
      if (prevOpenRef.current) return
      prevOpenRef.current = true

      exitRef.current?.cancel()
      exitRef.current = null
      setMounted(true)
      notifyRef.current?.(true)
      actionRef.current = 'enter'
      return
    }

    if (!prevOpenRef.current) return
    prevOpenRef.current = false

    const element = paneRef.current
    if (!element || !canSlide()) {
      setMounted(false)
      notifyRef.current?.(false)
      return
    }

    actionRef.current = 'exit'
    const dx = slideDistance(element)
    const anim = element.animate(
      [
        { transform: 'translateX(0px)', opacity: 1 },
        { transform: `translateX(${dx}px)`, opacity: 0.4 },
      ],
      { duration: SLIDE_MS, easing: EASE, fill: 'forwards' },
    )

    const job: ExitJob = {
      cancelled: false,
      cancel() {
        job.cancelled = true
        window.clearTimeout(timer)
        anim.cancel()
      },
    }
    exitRef.current = job

    const finalize = () => {
      if (job.cancelled) return
      exitRef.current = null
      actionRef.current = 'idle'
      setMounted(false)
      notifyRef.current?.(false)
    }
    anim.finished.then(finalize).catch(() => {
      // 被打断时由新一轮进场接管
    })
    const timer = window.setTimeout(finalize, SLIDE_MS + 200)

    return () => {
      if (exitRef.current === job) exitRef.current = null
      window.clearTimeout(timer)
    }
  }, [open])

  /** 进场：aside 真正挂进 DOM 后播放，否则元素未在场等于漏播。 */
  useEffect(() => {
    if (actionRef.current !== 'enter') return
    const element = paneRef.current
    // aside 还没挂进 DOM（首次从关闭翻成打开的那帧）：保留 enter 状态，
    // 等 mounted 翻成 true 后本 effect 以新依赖重跑，动画才有机会播。
    if (!element) return
    if (!canSlide()) {
      if (actionRef.current === 'enter') actionRef.current = 'idle'
      return
    }
    const dx = slideDistance(element)
    const anim = element.animate(
      [
        { transform: `translateX(${dx}px)`, opacity: 0.5 },
        { transform: 'translateX(0px)', opacity: 1 },
      ],
      { duration: SLIDE_MS, easing: EASE },
    )
    anim.finished
      .then(() => {
        if (actionRef.current === 'enter') actionRef.current = 'idle'
      })
      .catch(() => {
        // 被新一轮动作打断，由对方接管
      })
  }, [open, mounted])

  if (!mounted) return null

  return (
    <aside
      ref={paneRef}
      className="app-right"
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
    >
      {open ? children : contentRef.current}
    </aside>
  )
}
