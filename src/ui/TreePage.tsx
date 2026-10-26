import { useMemo } from 'react'
import { breadcrumb, type LearnNode } from '../domain/tree'
import type { LearnData } from '../app/store'

export interface TreePageProps {
  data: LearnData
  nodeId: string
  onNavigate(nodeId: string): void
  onBack(): void
}

interface Row {
  node: LearnNode
  depth: number
}

function outline(nodes: LearnNode[], rootId: string): Row[] {
  const rows: Row[] = []
  const visit = (parentId: string, depth: number) => {
    nodes
      .filter((node) => node.parentId === parentId)
      .forEach((node) => {
        rows.push({ node, depth })
        visit(node.id, depth + 1)
      })
  }
  const root = nodes.find((node) => node.id === rootId)
  if (!root) return rows
  rows.push({ node: root, depth: 0 })
  visit(rootId, 1)
  return rows
}

export function TreePage({ data, nodeId, onNavigate, onBack }: TreePageProps) {
  const rootId = useMemo(() => {
    const path = breadcrumb(data.nodes, nodeId)
    return path[0]?.id ?? nodeId
  }, [data.nodes, nodeId])

  const rows = useMemo(() => outline(data.nodes, rootId), [data.nodes, rootId])

  return (
    <div className="page">
      <header className="reader-head">
        <button type="button" className="icon-btn" onClick={onBack} aria-label="返回">
          ←
        </button>
        <div className="reader-crumb">
          <span className="crumb-current">树总览</span>
        </div>
        <span className="icon-btn" />
      </header>

      <ul className="tree-list">
        {rows.map(({ node, depth }) => (
          <li key={node.id} style={{ paddingLeft: `${depth * 16}px` }}>
            <button
              type="button"
              className={`tree-row ${node.id === nodeId ? 'tree-row-current' : ''}`}
              onClick={() => onNavigate(node.id)}
            >
              <span className="tree-question">{node.messages[0]?.content}</span>
              {node.anchor && <span className="tree-anchor">「{node.anchor.text}」</span>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
