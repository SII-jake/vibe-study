/**
 * 对话节点服务端仓库：多设备同步的唯一事实源。
 *
 * 数据形态是前端问答树的节点数组整棵快照，写入方是各端浏览器的
 * 防抖上传。整棵替换的语义下用版本号做乐观锁：PUT 必须带自己基于的
 * baseVersion，与当前版本不一致即拒绝并回最新数据，避免旧设备拿
 * 过期快照覆盖新设备刚写的内容。
 *
 * 落盘是单 JSON 文件写后替换：写临时文件再 rename，读者不会读到
 * 写了一半的文件；个人自用规模不需要数据库。文件损坏按空库起步，
 * 不让一次坏盘把整个服务拖死。
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export const DEFAULT_NODE_FILE = 'server/data/learn-nodes.json'

function readSnapshot(filePath) {
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8'))
    if (typeof parsed !== 'object' || parsed === null) throw new Error('bad snapshot')
    return {
      version: Number.isInteger(parsed.version) && parsed.version >= 0 ? parsed.version : 0,
      nodes: Array.isArray(parsed.nodes) ? parsed.nodes : [],
    }
  } catch {
    return { version: 0, nodes: [] }
  }
}

function persistSnapshot(filePath, snapshot) {
  mkdirSync(dirname(filePath), { recursive: true })
  const tempPath = `${filePath}.tmp`
  writeFileSync(tempPath, JSON.stringify(snapshot), 'utf8')
  renameSync(tempPath, filePath)
}

export function createNodeStore({ filePath = DEFAULT_NODE_FILE } = {}) {
  let snapshot = readSnapshot(filePath)

  return {
    filePath,
    getVersion: () => snapshot.version,
    getNodes: () => snapshot.nodes,

    /**
     * 基于 baseVersion 整棵替换节点数组。
     * 返回 { ok: true, version } 或 { ok: false, version, nodes }（冲突时的最新数据）。
     */
    save(nodes, baseVersion) {
      if (baseVersion !== snapshot.version) {
        return { ok: false, version: snapshot.version, nodes: snapshot.nodes }
      }
      snapshot = { version: snapshot.version + 1, nodes }
      persistSnapshot(filePath, snapshot)
      return { ok: true, version: snapshot.version }
    },
  }
}

/** 节点负载的轻量校验：不是深校验，只挡下会把树写坏的明显坏形状。 */
export function isValidNodesPayload(nodes) {
  if (!Array.isArray(nodes)) return false
  return nodes.every(
    (node) =>
      typeof node === 'object' &&
      node !== null &&
      typeof node.id === 'string' &&
      node.id !== '' &&
      (node.parentId === null || typeof node.parentId === 'string') &&
      Array.isArray(node.messages),
  )
}
