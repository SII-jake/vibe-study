// 客户端中途断开时静态服务必须释放读流（2026-11-22 真机"css 一直卡死"排查）。
//
// 机制：response 被销毁后 pipe 解绑，createReadStream 永久停在暂停态，
// 文件 fd 再也不会回收。远端 pid 55216 里那条
//   fd 25 -> dist/static/css/main.e4ff919b.css
// 就是一次被取消的请求留下的。
// 泄漏累积到进程 fd 上限（或用满 inotify/句柄）后，新的静态请求就再也拿不到
// 描述符，表现正是"这个文件一直卡死"。
import { createServer } from 'node:http'
import { connect } from 'node:net'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readdirSync, readlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { createStaticHandler } from '../server/static.mjs'

const root = mkdtempSync(join(tmpdir(), 'vibe-leak-'))
mkdirSync(join(root, 'static/css'), { recursive: true })
writeFileSync(join(root, 'index.html'), '<!doctype html><div id="root"></div>')
// 用足够大的文件：读流不会在客户端断开前自然读尽
writeFileSync(join(root, 'static/css/main.big00001.css'), '.a{color:red}\n'.repeat(80_000))

afterAll(() => rmSync(root, { recursive: true, force: true }))

/** 统计本进程内仍打开的、指向测试目录的 fd 数量。 */
const openAssetFds = () => {
  try {
    return readdirSync(`/proc/${process.pid}/fd`).filter((fd) => {
      try {
        return readlinkSync(`/proc/${process.pid}/fd/${fd}`).includes(root)
      } catch {
        return false
      }
    }).length
  } catch {
    return -1
  }
}

/** 发一个请求，收到首块响应就立刻断开，模拟浏览器/WebView 取消。 */
const abortOne = (port, useGzip) =>
  new Promise((resolve) => {
    const socket = connect(port, '127.0.0.1', () => {
      const encoding = useGzip ? 'Accept-Encoding: gzip\r\n' : ''
      socket.write(
        `GET /static/css/main.big00001.css HTTP/1.1\r\nHost: x\r\n${encoding}Connection: keep-alive\r\n\r\n`,
      )
    })
    socket.once('data', () => {
      socket.destroy()
      resolve()
    })
    socket.on('error', () => resolve())
    setTimeout(() => {
      socket.destroy()
      resolve()
    }, 500)
  })

describe('静态读流在客户端中断后释放', () => {
  it('连续中断 30 次后不残留文件 fd', async () => {
    const handler = createStaticHandler(root, { auth: { enabled: false } })
    const server = createServer((req, res) => {
      void handler(req, res)
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address()
    try {
      const before = openAssetFds()
      for (const useGzip of [true, false]) {
        for (let i = 0; i < 15; i++) await abortOne(port, useGzip)
      }
      // 给事件循环时间处理 close/error
      await new Promise((r) => setTimeout(r, 800))
      const after = openAssetFds()
      expect(after - before).toBe(0)
    } finally {
      await new Promise((r) => server.close(r))
    }
  })
})
