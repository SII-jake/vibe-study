/**
 * 问答树三路合并（git 式 merge）：base 为本端上次与服务端一致的快照，
 * local / remote 是基于 base 各自演化的两棵树。
 *
 * 粒度取节点与消息两级：
 * - 节点：同 id 三方对齐；仅一侧改/加用该侧；一侧删一侧没动跟删；
 *   一侧删一侧改，改动方胜出（丢远端新回答比少删一个子树更难挽回）。
 * - 消息：同节点内按 id 对齐的并集，仅一侧删的消息跟删；
 *   同 id 两侧内容不同取本地一侧（本地优先收敛）。
 * - 标题/base 之外的其余节点字段（parentId、anchor、createdAt）创建后
 *   不变，取任意一侧即可；标题两侧都改且不同取远端——服务端是多设备
 *   汇聚点，取远端保证各端收敛到同一标题。
 */

import type { LearnNode, Message } from './tree'

function byIdOf<T extends { id: string }>(items: T[]): Map<string, T> {
  return new Map(items.map((item) => [item.id, item]))
}

function mergeMessages(base: Message[], local: Message[], remote: Message[]): Message[] {
  const baseById = byIdOf(base)
  const localById = byIdOf(local)
  const remoteById = byIdOf(remote)
  const ordered = [...local, ...remote].filter(
    (item, index, all) => all.findIndex((other) => other.id === item.id) === index,
  )

  const merged: Message[] = []
  for (const candidate of ordered) {
    const inBase = baseById.get(candidate.id)
    const inLocal = localById.get(candidate.id)
    const inRemote = remoteById.get(candidate.id)
    // base 里存在、恰少了一侧：那一侧删了它，删除生效
    if (inBase && (!inLocal || !inRemote)) continue
    const picked =
      inLocal && inRemote && inLocal.content !== inRemote.content
        ? inLocal.createdAt >= inRemote.createdAt
          ? inLocal
          : inRemote
        : (inLocal ?? inRemote)
    if (picked) merged.push(picked)
  }
  return merged.sort((a, b) => a.createdAt - b.createdAt)
}

function sameNode(next: LearnNode | undefined, base: LearnNode | undefined): boolean {
  if (!next || !base) return next === base
  return (
    next.parentId === base.parentId &&
    next.createdAt === base.createdAt &&
    (next.title ?? null) === (base.title ?? null) &&
    next.messages.length === base.messages.length &&
    next.messages.every(
      (message, index) =>
        message.id === base.messages[index]?.id && message.content === base.messages[index]?.content,
    )
  )
}

function mergeOneNode(
  base: LearnNode | undefined,
  local: LearnNode | undefined,
  remote: LearnNode | undefined,
): LearnNode | null {
  // base 里没有：一侧（或两侧）新增的节点，有直接保留；两侧同 id 取晚建的一侧
  if (!base) {
    if (!local) return remote ?? null
    if (!remote) return local
    return local.createdAt >= remote.createdAt ? local : remote
  }
  // 一侧删、另一侧相对 base 动了：改动胜出，保住仍在写的那侧数据
  if (!local) return remote && !sameNode(remote, base) ? remote : null
  if (!remote) return sameNode(local, base) ? null : local

  const picked = sameNode(remote, base) ? local : remote
  return {
    ...picked,
    messages: mergeMessages(base.messages, local.messages, remote.messages),
  }
}

/** 三路合并两棵问答树；输入不受影响，返回按 createdAt 排序的新数组。 */
export function mergeNodes(base: LearnNode[], local: LearnNode[], remote: LearnNode[]): LearnNode[] {
  const baseById = byIdOf(base)
  const localById = byIdOf(local)
  const remoteById = byIdOf(remote)
  const ids = [...base, ...local, ...remote]
    .map((node) => node.id)
    .filter((id, index, all) => all.indexOf(id) === index)

  const merged: LearnNode[] = []
  for (const id of ids) {
    const node = mergeOneNode(baseById.get(id), localById.get(id), remoteById.get(id))
    if (node) merged.push(node)
  }
  return merged.sort((a, b) => a.createdAt - b.createdAt)
}
