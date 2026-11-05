// 三路合并（git 式）：base 为上次与服务端一致的快照，local/remote 各走各的。
import { describe, expect, it } from 'vitest'
import { mergeNodes } from '../src/domain/node-merge'
import type { LearnNode } from '../src/domain/tree'

function message(id: string, content: string, createdAt: number, role: 'user' | 'assistant' = 'user') {
  return { id, role, content, createdAt }
}

function root(id: string, content: string, createdAt: number, extra: Partial<LearnNode> = {}): LearnNode {
  return {
    id,
    parentId: null,
    anchor: null,
    messages: [message(`${id}-m0`, content, createdAt)],
    createdAt,
    ...extra,
  }
}

function child(id: string, parentId: string, content: string, createdAt: number): LearnNode {
  return {
    id,
    parentId,
    anchor: { messageId: `${parentId}-a1`, fragmentIndex: 0, text: '锚点' },
    messages: [message(`${id}-m0`, content, createdAt)],
    createdAt,
  }
}

describe('mergeNodes', () => {
  it('两侧都没动：结果与 base 相同', () => {
    const base = [root('n-a', '什么是复利？', 1)]
    expect(mergeNodes(base, base, base)).toEqual(base)
  })

  it('仅本地新增节点、远端没动：保留本地新增', () => {
    const base = [root('n-a', '什么是复利？', 1)]
    const local = [...base, child('n-b', 'n-a', '利滚利是什么', 2)]
    expect(mergeNodes(base, local, base)).toEqual(local)
  })

  it('仅远端有更新、本地没动：快进到远端（轮询拉取场景）', () => {
    const base = [root('n-a', '什么是复利？', 1)]
    const remote = [...base, child('n-c', 'n-a', '再讲细一点', 3)]
    expect(mergeNodes(base, base, remote)).toEqual(remote)
  })

  it('两侧各加不同子节点：两边都在，按 createdAt 排序', () => {
    const base = [root('n-a', '什么是复利？', 1)]
    const local = [...base, child('n-b', 'n-a', '利滚利是什么', 2)]
    const remote = [...base, child('n-c', 'n-a', '举例算一下', 4)]
    const merged = mergeNodes(base, local, remote)
    expect(merged.map((node) => node.id)).toEqual(['n-a', 'n-b', 'n-c'])
  })

  it('同一节点两侧各追加不同消息：两条都保留，按 createdAt 排', () => {
    const base = [root('n-a', '什么是复利？', 1)]
    const local = [{ ...base[0]!, messages: [...base[0]!.messages, message('n-a-u1', '追问A', 10)] }]
    const remote = [{ ...base[0]!, messages: [...base[0]!.messages, message('n-a-u2', '追问B', 20)] }]
    const merged = mergeNodes(base, local, remote)
    expect(merged[0]!.messages.map((item) => item.id)).toEqual(['n-a-m0', 'n-a-u1', 'n-a-u2'])
  })

  it('本地删了消息（重新生成前清尾）、远端没动：删除生效', () => {
    const baseNode = root('n-a', '什么是复利？', 1)
    baseNode.messages.push(message('n-a-a1', '旧回答', 5, 'assistant'))
    const base = [baseNode]
    const local = [{ ...baseNode, messages: baseNode.messages.slice(0, 1) }]
    const merged = mergeNodes(base, local, base)
    expect(merged[0]!.messages.map((item) => item.id)).toEqual(['n-a-m0'])
  })

  it('本地删子树、远端没动：删除生效', () => {
    const base = [root('n-a', '什么是复利？', 1), child('n-b', 'n-a', '利滚利是什么', 2)]
    expect(mergeNodes(base, base.slice(0, 1), base)).toEqual(base.slice(0, 1))
  })

  it('本地删子树、远端改了其中节点：改动方胜出，不丢远端数据', () => {
    const base = [root('n-a', '什么是复利？', 1), child('n-b', 'n-a', '利滚利是什么', 2)]
    const remote = [
      base[0]!,
      { ...base[1]!, messages: [...base[1]!.messages, message('n-b-a1', '回答', 6, 'assistant')] },
    ]
    const merged = mergeNodes(base, base.slice(0, 1), remote)
    expect(merged).toEqual(remote)
  })

  it('标题只有一侧改：用改的那侧；两侧都改且不同：取远端（服务端为汇聚点）', () => {
    const base = [root('n-a', '什么是复利？', 1)]
    const localTitled = [{ ...base[0]!, title: '本地标题' }]
    expect(mergeNodes(base, localTitled, base)[0]!.title).toBe('本地标题')

    const remoteTitled = [{ ...base[0]!, title: '远端标题' }]
    expect(mergeNodes(base, localTitled, remoteTitled)[0]!.title).toBe('远端标题')
  })

  it('远端删了节点、本地没动：跟随远端删除（反向快删）', () => {
    const base = [root('n-a', '什么是复利？', 1), child('n-b', 'n-a', '利滚利是什么', 2)]
    expect(mergeNodes(base, base, base.slice(0, 1))).toEqual(base.slice(0, 1))
  })
})
