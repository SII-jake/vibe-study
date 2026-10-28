import { type RefObject, useEffect, useRef, useState } from 'react'

/**
 * 测量容器实际宽度。
 * 轨道要按「视口中栏宽 + 剩余右手栏宽」铺格，必须拿到真实像素宽；
 * 没有 ResizeObserver 的环境退回 window 尺寸兜底，避免宽度永远为 0。
 */
export function useElementWidth<T extends HTMLElement>(): [RefObject<T>, number] {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const element = ref.current
    if (!element) return undefined

    const measure = () => setWidth(element.getBoundingClientRect().width)
    measure()

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure)
      return () => window.removeEventListener('resize', measure)
    }

    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return [ref, width]
}
