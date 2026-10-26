/**
 * 纯文本定位：先精确匹配，再退到去空白匹配。
 * 去空白匹配覆盖两类差异：浏览器跨块选区引入的空白，与 Markdown 折行折出的空白。
 */

export interface TextRange {
  /** 起始位置，相对传入的 text */
  start: number
  /** 结束位置（不含） */
  end: number
}

function squash(text: string): { squashed: string; positions: number[] } {
  const positions: number[] = []
  let squashed = ''
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] ?? ''
    if (/\s/.test(char)) continue
    squashed += char
    positions.push(index)
  }
  return { squashed, positions }
}

/** 在 text 中定位 target；返回原文位置区间，找不到返回 null。 */
export function locateRange(text: string, target: string): TextRange | null {
  if (target === '') return null

  const exact = text.indexOf(target)
  if (exact >= 0) return { start: exact, end: exact + target.length }

  const haystack = squash(text)
  const needle = squash(target).squashed
  if (needle === '') return null
  const hit = haystack.squashed.indexOf(needle)
  if (hit < 0) return null

  const start = haystack.positions[hit]
  const lastPosition = haystack.positions[hit + needle.length - 1]
  if (start === undefined || lastPosition === undefined) return null
  return { start, end: lastPosition + 1 }
}
