import DOMPurify from 'dompurify'
import { marked } from 'marked'
import type { Fragment } from '../domain/fragment'

marked.setOptions({ gfm: true, breaks: true })

/**
 * 把片段原文渲染成安全的 HTML。
 * 回答来自模型，一律按不可信内容处理：先转 HTML，再经 DOMPurify 白名单过滤。
 */
export function renderFragmentHtml(fragment: Fragment): string {
  const raw = marked.parse(fragment.raw, { async: false }) as string
  const sanitized = DOMPurify.sanitize(raw, {
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'img'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick', 'style'],
  })
  return sanitized.replace(/<a /g, '<a target="_blank" rel="noreferrer" ')
}
