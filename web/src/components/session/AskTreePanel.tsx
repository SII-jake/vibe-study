import { useState } from 'react'
import { Modal } from '../base/Modal.js'
import {
  defaultExpandedOf,
  expandableIdsOf,
  flattenAskTree,
  type AskTree,
} from '../messages/askTree.js'
import styles from './AskTreePanel.module.css'

/**
 * 追问树导航面板（decisions/2026-11-25-ask-tree-navigator.md §三）。
 *
 * 追问一多，只能沿引子卡逐层进出，找不回之前的分支；这里把整棵树摊开、
 * 标出当前位置，点任一节点直接跳过去（planJumpTo → 目标进中栏）。
 * 本版不做筛选（用户明确：搜索以后另行设计，要同时搜提问与回答内容）。
 */
export function AskTreePanel({
  tree,
  currentId,
  onJump,
  onClose,
}: {
  tree: AskTree
  /** 当前所在节点（已归一到 lane 根）；主线根层为根 id */
  currentId: string | null
  onJump: (nodeId: string) => void
  onClose: () => void
}) {
  // 默认只展开到当前位置；用户手动折叠/展开后以手动状态为准
  const [expanded, setExpanded] = useState<Set<string>>(() => defaultExpandedOf(tree, currentId))
  const rows = flattenAskTree(tree, expanded, currentId)

  const toggle = (nodeId: string) => {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(nodeId)) next.delete(nodeId)
      else next.add(nodeId)
      return next
    })
  }
  const expandAll = () => setExpanded(new Set(expandableIdsOf(tree)))
  const collapseAll = () => setExpanded(new Set())

  const empty = tree.total === 0

  return (
    <Modal
      title="追问树"
      closable
      onClose={onClose}
      className={styles.panel}
      mainClassName={styles.main}
      footer={
        empty ? undefined : (
          <div className={styles.footer}>
            <button type="button" className={styles.footerButton} data-ask-tree-expand-all onClick={expandAll}>
              全部展开
            </button>
            <button type="button" className={styles.footerButton} data-ask-tree-collapse-all onClick={collapseAll}>
              全部折叠
            </button>
          </div>
        )
      }
    >
      <div data-ask-tree-panel>
        {empty ? (
          <p className={styles.empty} data-ask-tree-empty>
            这条对话还没有追问。选中回答里的任意一段文字，就能开一条追问。
          </p>
        ) : (
          <div className={styles.rows} role="tree" aria-label="追问树">
            {rows.map((row) => (
              <div
                key={`${row.orphan ? 'orphan' : 'tree'}:${row.node.id}`}
                className={styles.row}
                data-ask-tree-row={row.node.id}
                data-depth={row.depth}
                data-current={row.current ? 'true' : undefined}
                data-orphan={row.orphan ? 'true' : undefined}
                style={{ paddingLeft: 8 + row.depth * 16 }}
                role="treeitem"
                aria-current={row.current ? 'true' : undefined}
                aria-expanded={row.hasChildren ? row.expanded : undefined}
                tabIndex={0}
                onClick={() => {
                  // 点当前行不重复跳转（避免无谓的 pane 重置），只收起面板
                  if (!row.current) onJump(row.node.id)
                  onClose()
                }}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' && event.key !== ' ') return
                  event.preventDefault()
                  if (!row.current) onJump(row.node.id)
                  onClose()
                }}
              >
                {row.hasChildren ? (
                  <button
                    type="button"
                    className={styles.toggle}
                    data-ask-tree-toggle
                    aria-label={row.expanded ? '折叠' : '展开'}
                    onClick={(event) => {
                      // 折叠箭头不触发跳转
                      event.stopPropagation()
                      toggle(row.node.id)
                    }}
                  >
                    {row.expanded ? '▾' : '▸'}
                  </button>
                ) : (
                  <span className={styles.toggleSpacer} aria-hidden />
                )}
                <span className={styles.body}>
                  <span className={styles.title}>
                    {row.node.title}
                    {row.current ? <span className={styles.currentMark}>当前位置</span> : null}
                    {row.orphan ? <span className={styles.orphanMark}>沉底</span> : null}
                  </span>
                  {/* 来源片段（用户选中的原文）：辨认"问的是哪一段" */}
                  {row.node.anchorText ? (
                    <span className={styles.anchor}>{row.node.anchorText}</span>
                  ) : null}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  )
}
