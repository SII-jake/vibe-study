// dev 模式清理残留 service worker：
// 之前生产构建注册的 SW 是 cache-first，会把旧的 /src/*.tsx 一直喂给浏览器，
// 表现就是「feature 1 有了，之后的改动看上去没有」。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanupStaleServiceWorkers } from '../src/sw-cleanup'

describe('cleanupStaleServiceWorkers', () => {
  beforeEach(() => {
    vi.stubGlobal('navigator', { serviceWorker: undefined })
    vi.stubGlobal('caches', undefined)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('没有 serviceWorker 能力时安静退出，不抛错', async () => {
    await expect(cleanupStaleServiceWorkers()).resolves.toBeUndefined()
  })

  it('注销所有已注册的 SW', async () => {
    const unregister = vi.fn(async () => true)
    vi.stubGlobal('navigator', {
      serviceWorker: { getRegistrations: async () => [{ unregister }, { unregister }] },
    })
    await cleanupStaleServiceWorkers()
    expect(unregister).toHaveBeenCalledTimes(2)
  })

  it('顺带清空 Cache Storage 里的旧 shell 与旧模块', async () => {
    const unregister = vi.fn(async () => true)
    const del = vi.fn(async () => true)
    vi.stubGlobal('navigator', {
      serviceWorker: { getRegistrations: async () => [{ unregister }] },
    })
    vi.stubGlobal('caches', {
      keys: async () => ['vibe-study-v1', 'other-cache'],
      delete: del,
    })
    await cleanupStaleServiceWorkers()
    expect(del).toHaveBeenCalledTimes(2)
    expect(del).toHaveBeenCalledWith('vibe-study-v1')
    expect(del).toHaveBeenCalledWith('other-cache')
  })

  it('部分注销失败时不影响其余清理完成', async () => {
    const ok = vi.fn(async () => true)
    const bad = vi.fn(async () => {
      throw new Error('cannot unregister')
    })
    vi.stubGlobal('navigator', {
      serviceWorker: { getRegistrations: async () => [{ unregister: bad }, { unregister: ok }] },
    })
    vi.stubGlobal('caches', {
      keys: async () => ['vibe-study-v1'],
      delete: vi.fn(async () => true),
    })
    await expect(cleanupStaleServiceWorkers()).resolves.toBeUndefined()
    expect(ok).toHaveBeenCalled()
  })
})
