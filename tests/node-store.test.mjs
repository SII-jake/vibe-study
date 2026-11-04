import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createNodeStore } from '../server/node-store.mjs'

const NODE_A = {
  id: 'n-a',
  parentId: null,
  anchor: null,
  messages: [{ id: 'n-a-m0', role: 'user', content: '什么是复利？', createdAt: 1 }],
  createdAt: 1,
}

let dir

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'vibe-node-store-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('createNodeStore', () => {
  it('空文件起步：版本 0、空节点列表', () => {
    const store = createNodeStore({ filePath: join(dir, 'nodes.json') })
    expect(store.getVersion()).toBe(0)
    expect(store.getNodes()).toEqual([])
  })

  it('save 落盘后重新创建 store 仍能读回，进程重启不丢', () => {
    const filePath = join(dir, 'nodes.json')
    const first = createNodeStore({ filePath })
    const result = first.save([NODE_A], 0)
    expect(result).toEqual({ ok: true, version: 1 })

    const second = createNodeStore({ filePath })
    expect(second.getVersion()).toBe(1)
    expect(second.getNodes()).toEqual([NODE_A])
  })

  it('baseVersion 与当前版本不一致时拒绝写入，保护后写设备不被旧快照覆盖', () => {
    const store = createNodeStore({ filePath: join(dir, 'nodes.json') })
    store.save([NODE_A], 0)
    const stale = store.save([], 0)
    expect(stale.ok).toBe(false)
    expect(stale.version).toBe(1)
    expect(store.getNodes()).toEqual([NODE_A])
  })

  it('版本号单调递增，每次成功 save 加一', () => {
    const store = createNodeStore({ filePath: join(dir, 'nodes.json') })
    expect(store.save([NODE_A], 0).version).toBe(1)
    expect(store.save([NODE_A, { ...NODE_A, id: 'n-b' }], 1).version).toBe(2)
    expect(store.getVersion()).toBe(2)
  })

  it('存量文件损坏时按空库起步，不让整个服务起不来', () => {
    const filePath = join(dir, 'nodes.json')
    writeFileSync(filePath, 'not-json{{{', 'utf8')
    const store = createNodeStore({ filePath })
    expect(store.getVersion()).toBe(0)
    expect(store.save([NODE_A], 0).ok).toBe(true)
    expect(createNodeStore({ filePath }).getNodes()).toEqual([NODE_A])
  })
})

describe('/api/nodes', () => {
  /** 起真实 HTTP 端口，与 server.test.mjs 同一套路。 */
  async function serve(handler) {
    const server = createServer(handler)
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address()
    return {
      base: `http://127.0.0.1:${port}`,
      close: () => new Promise((resolve) => server.close(resolve)),
    }
  }

  it('GET 返回当前版本与节点，并带 X-Nodes-Version 头；PUT 冲突返回 409 与最新数据', async () => {
    const { createHandler } = await import('../server/handler.mjs')
    const store = createNodeStore({ filePath: join(dir, 'nodes.json') })
    const handler = createHandler(
      { baseUrl: '', apiKey: '', model: '', models: [], serperKey: '', jinaKey: '' },
      fetch,
      { nodeStore: store },
    )
    const running = await serve(handler)
    try {
      const initial = await fetch(`${running.base}/api/nodes`)
      expect(initial.status).toBe(200)
      expect(initial.headers.get('X-Nodes-Version')).toBe('0')
      expect(await initial.json()).toEqual({ version: 0, nodes: [] })

      const put = await fetch(`${running.base}/api/nodes`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseVersion: 0, nodes: [NODE_A] }),
      })
      expect(put.status).toBe(200)
      expect(await put.json()).toEqual({ version: 1 })

      const conflict = await fetch(`${running.base}/api/nodes`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseVersion: 0, nodes: [] }),
      })
      expect(conflict.status).toBe(409)
      expect(await conflict.json()).toEqual({ version: 1, nodes: [NODE_A] })

      const after = await fetch(`${running.base}/api/nodes`)
      expect(after.headers.get('X-Nodes-Version')).toBe('1')
    } finally {
      await running.close()
    }
  })

  it('PUT 拒绝非法负载：非数组节点、缺 id、非整数 baseVersion', async () => {
    const { createHandler } = await import('../server/handler.mjs')
    const store = createNodeStore({ filePath: join(dir, 'nodes.json') })
    const handler = createHandler(
      { baseUrl: '', apiKey: '', model: '', models: [], serperKey: '', jinaKey: '' },
      fetch,
      { nodeStore: store },
    )
    const running = await serve(handler)
    try {
      const bad = (body) =>
        fetch(`${running.base}/api/nodes`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
      expect((await bad({ baseVersion: 0, nodes: 'nope' })).status).toBe(400)
      expect((await bad({ baseVersion: 0, nodes: [{ noId: true }] })).status).toBe(400)
      expect((await bad({ baseVersion: 'x', nodes: [] })).status).toBe(400)
      expect((await bad({ nodes: [] })).status).toBe(400)
      expect(store.getVersion()).toBe(0)
    } finally {
      await running.close()
    }
  })
})
