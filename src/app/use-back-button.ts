/** Android 返回键接管：远程壳内把硬件返回键接到应用内路由回退上。 */
import { useEffect, useRef } from 'react'
import type { Route } from './route'

/** root 页两次返回键的最大间隔：间隔内的第二次按下才真正退出应用。 */
export const DOUBLE_BACK_EXIT_MS = 2200

export type BackPressAction = 'back' | 'prompt' | 'exit'

/**
 * 返回键判定（纯函数，供插件回调与测试共用）：
 * - 非 root：应用内路由回退（不退应用）。
 * - root：2.2s 内第二次按下才退出（exit）；否则提示（prompt）。
 * 回退后调用方负责把 lastPressAt 复位为 0（见 hook 内实现）。
 */
export function resolveBackPress(
  route: Route,
  lastPressAt: number,
  now: number,
): { action: BackPressAction } {
  if (route.kind !== 'topics') return { action: 'back' }
  if (lastPressAt !== 0 && now - lastPressAt < DOUBLE_BACK_EXIT_MS) {
    return { action: 'exit' }
  }
  return { action: 'prompt' }
}

export interface BackButtonHandlers {
  route: Route
  /** 非 root：回退到应用内上一个路由。 */
  goBack: () => void
  /** root 首次按下：提示再按一次退出（壳内由各自提示层负责，可为空）。 */
  showExitPrompt?: () => void
}

export interface BackButtonSource {
  addListener: (cb: () => void) => { remove: () => void } | Promise<{ remove: () => void }>
  exitApp: () => void
}

/**
 * 把硬件返回键接到应用路由上；浏览器（非 Capacitor）环境不接线，
 * 浏览器自带后退已由 hash 路由天然覆盖。source 默认取 Capacitor 原生事件。
 */
export function useBackButton(
  { route, goBack, showExitPrompt }: BackButtonHandlers,
  source?: BackButtonSource,
) {
  const lastPressAt = useRef(0)
  /** ref 持有最新处理器，避免每次路由变化都增删原生监听。 */
  const handlers = useRef({ route, goBack, showExitPrompt })
  handlers.current = { route, goBack, showExitPrompt }

  useEffect(() => {
    if (source === undefined && !('Capacitor' in window)) return undefined
    const resolved: Promise<BackButtonSource> =
      source !== undefined
        ? Promise.resolve(source)
        : import('@capacitor/app').then((m) => m.App as unknown as BackButtonSource)
    let cancelled = false
    let handle: { remove: () => void } | undefined
    void resolved.then((src) => {
      if (cancelled) return
      const result = src.addListener(() => {
        const { route: current, goBack: back, showExitPrompt: prompt } = handlers.current
        const now = Date.now()
        const { action } = resolveBackPress(current, lastPressAt.current, now)
        if (action === 'back') {
          lastPressAt.current = 0
          back()
          return
        }
        if (action === 'exit') {
          lastPressAt.current = 0
          src.exitApp()
          return
        }
        lastPressAt.current = now
        prompt?.()
      })
      if (result instanceof Promise) {
        void result.then((h) => {
          handle = h
        })
      } else {
        handle = result
      }
    })
    return () => {
      cancelled = true
      handle?.remove()
    }
  }, [source])
}
