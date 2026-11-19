/** 选中的待追问原文：所在回答 id + 原文 + 片段索引（片段级锚点）+ 选区矩形；
 * 选区离开回答正文即清空。片段宿主缺席的旧渲染 fragmentIndex 为 null（消息级退化）。
 * 类型归在本模块（选区捕获的唯一入口），SessionView 等调用方从这里 import。 */
export type AskSelection = {
  anchorMessageId: string
  anchorText: string
  fragmentIndex: number | null
  /** 选区所在栏（decisions/2026-11-19 §二.3 planAsk 的分流依据）：
   *  中栏选文追问两栏不动右栏起草；右栏选文追问当前右栏先沉中栏再起草。 */
  pane: 'main' | 'right'
  rect: DOMRect
}

/**
 * 片段级锚点（decisions/2026-11-19）的选区捕获唯一入口。
 * 向上捕获 anchorMessageId 与原文文字之外，同时记录 fragmentIndex——
 * 片段宿主缺席的旧渲染形态退化为 fragmentIndex: null（消息级），
 * 不阻塞追问流转。
 * rect 由调用层在"停顿"判定后读（拖选随手柄轨迹变，瞬时不稳）；
 * 本函数只读静态宿主信息，不接触 DOMRect。
 */
export function readAskSelection(
  selection: Selection,
): Omit<AskSelection, 'rect'> | null {
  const text = selection.toString().trim()
  if (selection.isCollapsed || text === '') return null
  const node =
    selection.anchorNode instanceof Element
      ? selection.anchorNode
      : selection.anchorNode?.parentElement ?? null
  const textHost = node?.closest('[data-ask-text]') ?? null
  const messageHost = textHost?.closest('[data-message-id]') ?? null
  if (!textHost || !messageHost) return null

  const fragmentHost = node?.closest('[data-fragment-index]') ?? null
  const rawFragment = fragmentHost?.getAttribute('data-fragment-index')
  const fragmentIndex =
    rawFragment !== null && rawFragment !== undefined ? Number.parseInt(rawFragment, 10) : null

  // 所在栏：选区宿主就近读栏容器；桌面双栏才铺这两条容器，手机单栏恒命中中栏
  const pane: 'main' | 'right' = messageHost.closest('[data-right-pane]') ? 'right' : 'main'

  return {
    anchorMessageId: messageHost.getAttribute('data-message-id') ?? '',
    anchorText: text,
    fragmentIndex:
      fragmentIndex !== null && Number.isNaN(fragmentIndex) === false ? fragmentIndex : null,
    pane,
  }
}
