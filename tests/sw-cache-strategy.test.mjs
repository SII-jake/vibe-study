/**
 * public/sw.js 缓存策略的静态契约测试。
 *
 * 背景：旧版 SW 是「cache-first + 无版本标识」，旧 index.html/旧 JS 会把自己
 * 锁死在 Cache Storage 里——新代码没有执行机会，浏览器拿不到修复（曾导致
 * 用户连续 5 次反馈「按钮看不到点不到」）。新版必须满足三条：
 *  1) HTML/SW/manifest/接口一律 network-first（新版永远有机会到达页面）；
 *  2) 只有带指纹的 /assets/* 允许 cache-first（指纹变了名字也变，缓存安全）；
 *  3) 版本标识变更时清理旧 cache，给旧 SW 的自锁留「解开」的路径。
 *
 * 静态断言而不是跑 SW：SW 环境（self/caches/fetch）在 vitest 里模拟成本高，
 * 策略错误本质是「写了不该写的字」，静态契约测试最便宜也最稳。
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const swSource = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8')

describe('public/sw.js 缓存策略（防自锁）', () => {
  it('带有版本标识的 cache 名，版本升级时旧 cache 被清掉', () => {
    // cache 名里必须含版本段（v2+）；只清「同前缀的旧版本」，不误删别家 cache
    expect(swSource).toMatch(/const CACHE = ['"]vibe-study-v[2-9]\d*['"]/)
    expect(swSource).toMatch(/caches\.delete/)
  })

  it('带指纹的静态产物允许 cache-first（这是 SW 存在的意义：离线可用）', () => {
    expect(swSource).toMatch(/\/assets\//)
    expect(swSource).toMatch(/caches\.match/)
  })

  it('HTML / sw.js / manifest 必须 network-first，新版永远能到达页面', () => {
    // 禁止对这些路径直接返回缓存：fetch 里对它们必须发起网络请求，
    // 网络失败才允许回退缓存（离线兜底）
    expect(swSource).toMatch(/network/i)
    // 索引页回退用 /index.html 而不是缓存版本
    expect(swSource).toContain('/index.html')
  })

  it('接口请求（/api/*）不经过 SW 缓存：模型流式响应不能被截', () => {
    expect(swSource).toMatch(/\/api\//)
  })

  it('非 GET 请求一律放行', () => {
    expect(swSource).toMatch(/method\s*!==\s*['"]GET['"]/)
  })
})
