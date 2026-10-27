// 启动页地址归一化逻辑测试（jsdom 环境，boot.js 作为页面脚本加载）
// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it } from 'vitest'

const bootSrc = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../android-shell/boot.js'),
  'utf8',
)

beforeEach(() => {
  window.localStorage.clear()
  // boot.js 挂在 window 上，每次重新执行保证状态隔离
  new Function(bootSrc)()
})

describe('normalizeServerUrl', () => {
  it('完整 https 地址原样返回并去掉尾斜杠', () => {
    expect(window.VibeBoot.normalizeServerUrl('https://study.sii.edu.cn/')).toBe(
      'https://study.sii.edu.cn',
    )
  })

  it('裸域名补 http 协议', () => {
    expect(window.VibeBoot.normalizeServerUrl('study.local')).toBe('http://study.local')
  })

  it('IP 加端口补 http 协议', () => {
    expect(window.VibeBoot.normalizeServerUrl('10.252.158.96:8787')).toBe(
      'http://10.252.158.96:8787',
    )
  })

  it('带路径时只保留源地址', () => {
    expect(window.VibeBoot.normalizeServerUrl('https://study.sii.edu.cn/n/abc')).toBe(
      'https://study.sii.edu.cn',
    )
  })

  it('空输入与非 http 协议返回 null', () => {
    expect(window.VibeBoot.normalizeServerUrl('')).toBeNull()
    expect(window.VibeBoot.normalizeServerUrl('   ')).toBeNull()
    expect(window.VibeBoot.normalizeServerUrl('ftp://x.com')).toBeNull()
    expect(window.VibeBoot.normalizeServerUrl('javascript:alert(1)')).toBeNull()
  })
})

describe('loadSavedServer / saveServer', () => {
  it('未保存时回落到默认地址', () => {
    expect(window.VibeBoot.loadSavedServer()).toBe('https://study.sii.edu.cn')
  })

  it('保存后再读取返回保存值', () => {
    window.VibeBoot.saveServer('http://10.0.0.1:8787')
    expect(window.VibeBoot.loadSavedServer()).toBe('http://10.0.0.1:8787')
  })

  it('保存的值损坏时回落到默认地址', () => {
    window.localStorage.setItem('vibe-study.server-url', '::::')
    expect(window.VibeBoot.loadSavedServer()).toBe('https://study.sii.edu.cn')
  })
})
