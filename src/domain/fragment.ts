/**
 * 把 Markdown 回答切成可独立挂锚点的片段。
 * 片段的切分口径：空行分隔的块级元素为一个片段，围栏代码块内部不切分。
 */

export type FragmentKind = 'heading' | 'paragraph' | 'list' | 'code' | 'quote' | 'table'

export interface Fragment {
  index: number
  kind: FragmentKind
  /** 原始 Markdown 片段，带标记 */
  raw: string
  /** 剥离行内标记后的纯文本，用于锚点定位与选区匹配 */
  text: string
}

const FENCE_PATTERN = /^\s*(?:```|~~~)/
const HEADING_PATTERN = /^\s{0,3}#{1,6}\s/
const LIST_PATTERN = /^\s*(?:[-*+]|\d+[.)])\s/
const QUOTE_PATTERN = /^\s*>/
const TABLE_PATTERN = /^\s*\|/

function stripInline(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/(\*\*\*|___)(.+?)\1/g, '$2')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(\*|_)(.+?)\1/g, '$2')
    .replace(/~~(.+?)~~/g, '$1')
}

function stripBlockPrefix(line: string): string {
  return line
    .replace(/^\s{0,3}#{1,6}\s+/, '')
    .replace(/^\s*>\s?/, '')
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '')
    .replace(/^\s*\|/, '')
    .replace(/\|\s*$/, '')
}

/** 把片段原文转成纯文本：去标记、去前缀符号、多行折成单行。 */
export function toPlainText(raw: string): string {
  return raw
    .split('\n')
    .filter((line) => !FENCE_PATTERN.test(line))
    .map((line) => stripInline(stripBlockPrefix(line)))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function splitFragments(markdown: string): Fragment[] {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  const blocks: Array<{ kind: FragmentKind; raw: string }> = []
  let buffer: string[] = []
  let bufferKind: FragmentKind | null = null

  const flush = () => {
    if (buffer.length === 0) return
    blocks.push({ kind: bufferKind ?? 'paragraph', raw: buffer.join('\n') })
    buffer = []
    bufferKind = null
  }

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? ''

    if (FENCE_PATTERN.test(line)) {
      flush()
      const fence: string[] = [line]
      i += 1
      while (i < lines.length && !FENCE_PATTERN.test(lines[i] ?? '')) {
        fence.push(lines[i] ?? '')
        i += 1
      }
      if (i < lines.length) fence.push(lines[i] ?? '')
      blocks.push({ kind: 'code', raw: fence.join('\n') })
      continue
    }

    if (line.trim() === '') {
      flush()
      continue
    }

    const kind: FragmentKind = HEADING_PATTERN.test(line)
      ? 'heading'
      : LIST_PATTERN.test(line)
        ? 'list'
        : QUOTE_PATTERN.test(line)
          ? 'quote'
          : TABLE_PATTERN.test(line)
            ? 'table'
            : 'paragraph'

    if (bufferKind !== null && bufferKind !== kind) flush()
    if (bufferKind === null) bufferKind = kind
    buffer.push(line)
  }
  flush()

  return blocks
    .map((block, index) => ({
      index,
      kind: block.kind,
      raw: block.raw,
      text: toPlainText(block.raw),
    }))
    .filter((fragment) => fragment.text !== '')
}
