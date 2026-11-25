import { useTranslate } from '../../i18n/index.js'
import { memo, useEffect, useMemo, useReducer, useState } from 'react'
import Prism from 'prismjs'
import {
  getHighlightLang,
  isHighlightLoaded,
  loadHighlight,
} from '../../services/markdown/highlight.js'
import { IconCheckOutline16, IconCopyOutline16 } from '../base/icons.js'
import { showToast } from '../base/toastState.js'
import { copyText } from '../../utils/clipboard.js'
import { MermaidDiagram } from './MermaidDiagram.js'
import styles from './CodeBlock.module.css'

/** 代码块标题栏：左侧语言名，右侧复制 */
const CodeInfoRow = ({
  code,
  infostring,
  showDiagram,
  onToggleDiagram,
}: {
  code: string
  infostring: string
  showDiagram: boolean
  onToggleDiagram?: () => void
}) => {
  const t = useTranslate()
  const [copied, setCopied] = useState(false)
  return (
    <div className={styles.container}>
      {onToggleDiagram ? (
        <div className="md-code-block-switch" aria-label={t('mermaidSwitchLabel')}>
          <button
            type="button"
            className={styles.button}
            aria-pressed={showDiagram}
            onClick={() => !showDiagram && onToggleDiagram()}
          >
            {t('mermaidDiagram')}
          </button>
          <button
            type="button"
            className={styles.button}
            aria-pressed={!showDiagram}
            onClick={() => showDiagram && onToggleDiagram()}
          >
            {t('mermaidCode')}
          </button>
        </div>
      ) : (
        <span className={styles.name}>{infostring}</span>
      )}
      <button
        type="button"
        className={styles.button}
        onClick={async () => {
          if (!(await copyText(code))) {
            showToast({ key: 'copyFailed' })
            return
          }
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        }}
      >
        {copied ? <IconCheckOutline16 /> : <IconCopyOutline16 />}
        <span>{t(copied ? 'copied' : 'copy')}</span>
      </button>
    </div>
  )
}

/** 划线锚点（与 MarkdownAstRenderer 的 AnchorSpec 同形）：代码块内选中的
 *  片段也要打 data-ask-referenced——高亮产物是 HTML 串，只能在切段后逐段
 *  高亮，否则标记会插进标签中间。 */
type CodeAnchor = { text: string; isReturn?: boolean; rootId?: string }

/** 按锚点把代码切成「带标记 / 不带标记」的片段；锚点按首次出现定位，
 *  互不重叠，重叠部分归先命中的锚点。 */
function splitCodeByAnchors(
  code: string,
  anchors: CodeAnchor[],
): Array<{ text: string; anchor?: CodeAnchor }> {
  type Span = { start: number; end: number; anchor: CodeAnchor }
  const spans: Span[] = []
  for (const anchor of anchors) {
    if (anchor.text === '') continue
    const start = code.indexOf(anchor.text)
    if (start < 0) continue
    const end = start + anchor.text.length
    if (spans.some((span) => start < span.end && end > span.start)) continue
    spans.push({ start, end, anchor })
  }
  if (spans.length === 0) return [{ text: code }]
  spans.sort((a, b) => a.start - b.start)
  const parts: Array<{ text: string; anchor?: CodeAnchor }> = []
  let cursor = 0
  for (const span of spans) {
    if (span.start > cursor) parts.push({ text: code.slice(cursor, span.start) })
    parts.push({ text: code.slice(span.start, span.end), anchor: span.anchor })
    cursor = span.end
  }
  if (cursor < code.length) parts.push({ text: code.slice(cursor) })
  return parts
}

/** 代码块：语言包按需加载，不支持或尚未加载的语言按纯文本显示 */
export const CodeBlock = memo(function CodeBlock({
  code,
  infostring,
  loading = false,
  anchors,
}: {
  code: string
  infostring: string
  loading?: boolean
  /** 划线锚点（真机反馈 2026-11-25）：代码块内选中过的片段常驻下划线 */
  anchors?: CodeAnchor[]
}) {
  const isMermaid = infostring.toLowerCase() === 'mermaid'
  const [showDiagram, setShowDiagram] = useState(true)
  // 语言包注册在全局 Prism 上，每次渲染直接判断；加载完成后触发一次重渲染
  const rerender = useReducer((n: number) => n + 1, 0)[1]
  const lang = getHighlightLang(infostring)
  const loaded = lang !== null && isHighlightLoaded(lang)
  useEffect(() => {
    if (lang === null || loaded) {
      return
    }
    let unmounted = false
    loadHighlight(lang).then(() => {
      if (!unmounted) {
        rerender()
      }
    })
    return () => {
      unmounted = true
    }
  }, [lang, loaded, rerender])
  const renderedHtml = useMemo(() => {
    const name = lang !== null && loaded ? lang : 'plaintext'
    return Prism.highlight(code, Prism.languages[name], name)
  }, [code, lang, loaded])
  return (
    <div className="md-code-block">
      <div className="md-code-block-banner">
        <CodeInfoRow
          code={code}
          infostring={infostring}
          showDiagram={showDiagram}
          onToggleDiagram={isMermaid ? () => setShowDiagram((show) => !show) : undefined}
        />
      </div>
      {isMermaid && showDiagram ? (
        <MermaidDiagram code={code} loading={loading} />
      ) : anchors && anchors.length > 0 ? (
        <pre>
          {splitCodeByAnchors(code, anchors).map((part, index) =>
            part.anchor ? (
              <span
                key={index}
                data-ask-referenced
                {...(part.anchor.isReturn ? { 'data-ask-return': true } : {})}
                {...(part.anchor.rootId ? { 'data-ask-root': part.anchor.rootId } : {})}
                dangerouslySetInnerHTML={{
                  __html: Prism.highlight(
                    part.text,
                    Prism.languages[lang !== null && loaded ? lang : 'plaintext'],
                    lang !== null && loaded ? lang : 'plaintext',
                  ),
                }}
              />
            ) : (
              <span
                key={index}
                dangerouslySetInnerHTML={{
                  __html: Prism.highlight(
                    part.text,
                    Prism.languages[lang !== null && loaded ? lang : 'plaintext'],
                    lang !== null && loaded ? lang : 'plaintext',
                  ),
                }}
              />
            ),
          )}
        </pre>
      ) : (
        <pre dangerouslySetInnerHTML={{ __html: renderedHtml }}></pre>
      )}
    </div>
  )
})
