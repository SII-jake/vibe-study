import { useEffect, useState } from 'react'

/** 响应式断点：桌面与手机布局的 DOM 二选一，不能藏一份在 DOM 里制造歧义。 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches)

  useEffect(() => {
    const media = window.matchMedia(query)
    setMatches(media.matches)
    const handler = (event: MediaQueryListEvent) => setMatches(event.matches)
    media.addEventListener('change', handler)
    return () => media.removeEventListener('change', handler)
  }, [query])

  return matches
}
