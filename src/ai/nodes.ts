/**
 * 对话同步客户端：只调自有服务端 /api/nodes，密钥不在这一侧出现。
 * 所有失败（HTTP 错误、网络异常、响应形状不对）一律降级为 null，
 * 由调用方决定稍后重试，不抛错打断主流程。
 */

import type { LearnNode } from '../domain/tree'

export interface RemoteNodes {
  version: number
  nodes: LearnNode[]
}

export type PushResult = { ok: true; version: number } | ({ ok: false } & RemoteNodes)

function isNodesArray(value: unknown): value is LearnNode[] {
  return Array.isArray(value) && value.every((node) => typeof node?.id === 'string')
}

export async function fetchRemoteNodes(
  fetchImpl: typeof fetch = fetch,
): Promise<RemoteNodes | null> {
  try {
    const response = await fetchImpl('/api/nodes')
    if (!response.ok) return null
    const body = (await response.json()) as Partial<RemoteNodes>
    if (!Number.isInteger(body.version) || !isNodesArray(body.nodes)) return null
    return { version: body.version!, nodes: body.nodes }
  } catch {
    return null
  }
}

export async function pushNodes(
  input: { baseVersion: number; nodes: LearnNode[] },
  fetchImpl: typeof fetch = fetch,
): Promise<PushResult | null> {
  try {
    const response = await fetchImpl('/api/nodes', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseVersion: input.baseVersion, nodes: input.nodes }),
    })
    if (response.status === 409) {
      const body = (await response.json()) as Partial<RemoteNodes>
      if (!Number.isInteger(body.version) || !isNodesArray(body.nodes)) return null
      return { ok: false, version: body.version!, nodes: body.nodes }
    }
    if (!response.ok) return null
    const body = (await response.json()) as { version?: unknown }
    if (!Number.isInteger(body.version)) return null
    return { ok: true, version: body.version as number }
  } catch {
    return null
  }
}
