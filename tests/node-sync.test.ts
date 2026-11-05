// 对话同步编排：防抖上传、轮询感知远端、冲突时三路合并后重推。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createNodeSync, PUSH_DEBOUNCE_MS } from '../src/app/node-sync'
import type { LearnNode } from '../src/domain/tree'

const NODE_A: LearnNode = {
  id: 'n-a',
  parentId: null,
  anchor: null,
  messages: [{ id: 'n-a-m0', role: 'user', content: '什么是复利？', createdAt: 1 }],
  createdAt: 1,
}

const NODE_B: LearnNode = { ...NODE_A, id: 'n-b', createdAt: 2 }
const NODE_C: LearnNode = { ...NODE_A, id: 'n-c', createdAt: 3 }

/** 模拟服务端：带版本校验的 /api/nodes 存取。 */
function fakeServer(initial: { version: number; nodes: LearnNode[] }) {
  const state = { version: initial.version, nodes: initial.nodes }
  const fetchImpl = vi.fn(async (input: unknown, init?: RequestInit) => {
    expect(input).toBe('/api/nodes')
    if (init?.method === 'PUT') {
      const body = JSON.parse(init.body as string) as { baseVersion: number; nodes: LearnNode[] }
      if (body.baseVersion !== state.version) {
        return new Response(JSON.stringify({ version: state.version, nodes: state.nodes }), {
          status: 409,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      state.version += 1
      state.nodes = body.nodes
      return new Response(JSON.stringify({ version: state.version }), { status: 200 })
    }
    return new Response(JSON.stringify({ version: state.version, nodes: state.nodes }), {
      status: 200,
    })
  })
  return { state, fetchImpl: fetchImpl as unknown as typeof fetch }
}

function harness(remoteFetch: typeof fetch, initialLocal: LearnNode[]) {
  let local = initialLocal
  const replaceLocal = vi.fn(async (nodes: LearnNode[]) => {
    local = nodes
  })
  const adopted: { nodes: LearnNode[]; base: LearnNode[] }[] = []
  const sync = createNodeSync({
    fetchImpl: remoteFetch,
    getLocal: () => local,
    replaceLocal,
    adoptRemote: (nodes, base) => adopted.push({ nodes, base }),
  })
  return { sync, replaceLocal, adopted, getLocal: () => local }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('createNodeSync.start', () => {
  it('服务端还是空库：把本地快照推上去立为基准', async () => {
    const server = fakeServer({ version: 0, nodes: [] })
    const { sync, getLocal } = harness(server.fetchImpl, [NODE_A])
    await sync.start()
    expect(server.state.version).toBe(1)
    expect(server.state.nodes).toEqual([NODE_A])
    expect(getLocal()).toEqual([NODE_A])
  })

  it('空库且本地也是空：只立空基准，不空转版本号', async () => {
    const server = fakeServer({ version: 0, nodes: [] })
    const { sync } = harness(server.fetchImpl, [])
    await sync.start()
    expect(server.state.version).toBe(0)
  })

  it('服务端已有数据：采用服务端快照覆盖本地（另一台设备先写过）', async () => {
    const server = fakeServer({ version: 2, nodes: [NODE_C] })
    const { sync, getLocal, adopted, replaceLocal } = harness(server.fetchImpl, [NODE_A])
    await sync.start()
    expect(getLocal()).toEqual([NODE_C])
    expect(replaceLocal).toHaveBeenCalledWith([NODE_C])
    expect(adopted[0]).toEqual({ nodes: [NODE_C], base: [NODE_A] })
  })

  it('服务端不可达：安静留在本地模式，不抛错', async () => {
    const down = (async () => {
      throw new Error('network down')
    }) as unknown as typeof fetch
    const { sync, getLocal } = harness(down, [NODE_A])
    await sync.start()
    expect(getLocal()).toEqual([NODE_A])
  })
})

describe('createNodeSync.watch', () => {
  it('本地变更防抖后上传最新快照，中间版本不逐个发', async () => {
    // 基准为服务端已有的单节点树：排除 seed 上传干扰版本计数
    const server = fakeServer({ version: 5, nodes: [NODE_C] })
    const { sync } = harness(server.fetchImpl, [NODE_C])
    await sync.start() // start 采用远端，版本不动

    sync.watch([NODE_A])
    await vi.advanceTimersByTimeAsync(PUSH_DEBOUNCE_MS / 2)
    sync.watch([NODE_C, NODE_B]) // 防抖重置，只发最终快照
    await vi.advanceTimersByTimeAsync(PUSH_DEBOUNCE_MS + 1)

    expect(server.state.version).toBe(6)
    expect(server.state.nodes).toEqual([NODE_C, NODE_B])
  })

  it('上传撞上 409：三路合并本地与远端后重推，合并结果落到本地', async () => {
    const server = fakeServer({ version: 0, nodes: [] })
    const { sync, getLocal, adopted } = harness(server.fetchImpl, [NODE_B])
    await sync.start() // seed [n-b]：基准 version 1

    // 另一台设备先写入了 n-c，服务端前进到 version 2
    server.state.version = 2
    server.state.nodes = [NODE_B, NODE_C]

    // 本端基于旧基准把 n-b 删了又加了 n-a
    sync.watch([NODE_A])
    await vi.advanceTimersByTimeAsync(PUSH_DEBOUNCE_MS + 1)

    // 合并结果：本地删 n-b 远端没动 → n-b 消失；n-a 与 n-c 共存（多转几拍走完全部 await 链）
    await vi.advanceTimersByTimeAsync(PUSH_DEBOUNCE_MS + 1)
    expect(server.state.nodes.map((node) => node.id)).toEqual(['n-a', 'n-c'])
    expect(getLocal()?.map((node) => node.id)).toEqual(['n-a', 'n-c'])
    expect(adopted.at(-1)?.nodes.map((node) => node.id)).toEqual(['n-a', 'n-c'])
  })
})

describe('createNodeSync.poll', () => {
  it('远端版本比基准新：合并后采用，并回推本地独有部分', async () => {
    const server = fakeServer({ version: 0, nodes: [] })
    const { sync, getLocal, adopted } = harness(server.fetchImpl, [NODE_A])
    await sync.start() // 基准 version 1，[n-a]

    // 远端由另一台设备加上 n-b，本端本地没动
    server.state.version = 2
    server.state.nodes = [NODE_A, NODE_B]
    await sync.poll()
    expect(getLocal()?.map((node) => node.id)).toEqual(['n-a', 'n-b'])
    expect(adopted.at(-1)?.nodes.map((node) => node.id)).toEqual(['n-a', 'n-b'])

    // 本端随后加了 n-c（仍在防抖期内、尚未上传），
    // 远端又由另一台设备删了 n-b——互不冲突，各自生效
    sync.watch([NODE_A, NODE_B, NODE_C])
    server.state.version = 3
    server.state.nodes = [NODE_A]
    await sync.poll()
    await vi.advanceTimersByTimeAsync(PUSH_DEBOUNCE_MS + 1)
    expect(server.state.nodes.map((node) => node.id)).toEqual(['n-a', 'n-c'])
    expect(adopted.at(-1)?.nodes.map((node) => node.id)).toEqual(['n-a', 'n-c'])
  })

  it('远端版本与基准一致：不发任何请求体变更', async () => {
    const server = fakeServer({ version: 0, nodes: [] })
    const { sync, adopted } = harness(server.fetchImpl, [NODE_A])
    await sync.start()
    const putsBefore = countPuts(server)
    await sync.poll()
    expect(countPuts(server)).toBe(putsBefore)
    expect(adopted).toHaveLength(0)
  })
})

function countPuts(server: ReturnType<typeof fakeServer>): number {
  return (server.fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.filter(
    ([, init]) => (init as RequestInit | undefined)?.method === 'PUT',
  ).length
}
