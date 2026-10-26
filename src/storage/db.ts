import { type IDBPDatabase, openDB } from 'idb'
import type { LearnNode } from '../domain/tree'

/** 本机持久化：全部节点存在同一张表里，根节点即为学习主题。 */

const DB_NAME = 'vibe-study'
const DB_VERSION = 1
const NODE_STORE = 'nodes'

let database: Promise<IDBPDatabase> | null = null

function db(): Promise<IDBPDatabase> {
  if (!database) {
    database = openDB(DB_NAME, DB_VERSION, {
      upgrade(instance) {
        if (!instance.objectStoreNames.contains(NODE_STORE)) {
          const store = instance.createObjectStore(NODE_STORE, { keyPath: 'id' })
          store.createIndex('parentId', 'parentId')
        }
      },
    })
  }
  return database
}

export async function loadNodes(): Promise<LearnNode[]> {
  const nodes = (await (await db()).getAll(NODE_STORE)) as LearnNode[]
  return nodes.sort((a, b) => a.createdAt - b.createdAt)
}

export async function replaceAllNodes(nodes: LearnNode[]): Promise<void> {
  const instance = await db()
  const tx = instance.transaction(NODE_STORE, 'readwrite')
  await tx.store.clear()
  await Promise.all(nodes.map((node) => tx.store.put(node)))
  await tx.done
}
