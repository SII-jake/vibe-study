// 构建来源核对：/api/health 报出「编译进 dist 的那一次 git commit」。
//
// 口径要点：commit 在**构建时**写入 dist/build-info.json，运行时只读产物，
// 不在运行时跑 git。运行时跑 git 会把「HEAD 已前进但构建失败、仍在用旧 dist」
// 的部署报成新版本——那正是这套核对要抓的场景，报错了等于没报。
import { createServer } from 'node:http'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { collectBuildInfo, readBuildInfo, writeBuildInfo } from '../server/build-info.mjs'
import { createHandler } from '../server/handler.mjs'

const dirs = []

const tempDist = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'vibe-build-info-'))
  dirs.push(dir)
  return dir
}

afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    await rm(dir, { recursive: true, force: true })
  }
})

const config = () => ({
  baseUrl: 'https://api.deepseek.com/v1',
  apiKey: '',
  model: 'deepseek-flash',
  models: [],
  serperKey: '',
  serperBase: '',
  jinaKey: '',
  jinaBase: '',
  deepseekKey: 'k',
  deepseekBase: 'https://api.deepseek.com',
  shellTools: true,
  auth: { enabled: false, password: '', cookie: 'vibe_auth', ttlDays: 30, secure: true },
})

async function serve(distDir) {
  const server = createServer(createHandler(config(), vi.fn(), { distDir }))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}

describe('读构建来源', () => {
  it('dist/build-info.json 存在时原样读出', async () => {
    const dir = await tempDist()
    await writeFile(
      join(dir, 'build-info.json'),
      JSON.stringify({
        commit: 'abc1234',
        branch: 'main',
        dirty: false,
        builtAt: '2026-11-26T09:00:00.000Z',
      }),
    )

    expect(await readBuildInfo(dir)).toEqual({
      commit: 'abc1234',
      branch: 'main',
      dirty: false,
      builtAt: '2026-11-26T09:00:00.000Z',
    })
  })

  it('没有产物文件时回 null——如实报「不知道」，不拿当前 HEAD 顶替', async () => {
    const dir = await tempDist()
    expect(await readBuildInfo(dir)).toBe(null)
  })

  it('文件损坏时也回 null，不让健康检查整个 500', async () => {
    const dir = await tempDist()
    await writeFile(join(dir, 'build-info.json'), '{ 这不是 JSON')
    expect(await readBuildInfo(dir)).toBe(null)
  })
})

describe('采集构建来源', () => {
  it('从 git 读出 commit、分支与是否有未提交改动', () => {
    const answers = {
      'rev-parse HEAD': 'deadbeef',
      'rev-parse --abbrev-ref HEAD': 'main',
      'status --porcelain --untracked-files=no': ' M web/src/x.ts\n',
    }
    const run = (_cmd, args) => answers[args.join(' ')]

    const info = collectBuildInfo(run)
    expect(info.commit).toBe('deadbeef')
    expect(info.branch).toBe('main')
    expect(info.dirty).toBe(true)
    expect(typeof info.builtAt).toBe('string')
  })

  it('干净仓库记 dirty: false', () => {
    const answers = {
      'rev-parse HEAD': 'deadbeef',
      'rev-parse --abbrev-ref HEAD': 'main',
      'status --porcelain --untracked-files=no': '',
    }
    expect(collectBuildInfo((_cmd, args) => answers[args.join(' ')]).dirty).toBe(false)
  })

  it('只看已跟踪文件的改动——线上工作区常有未跟踪的运维文件，不该算脏', () => {
    const calls = []
    const answers = {
      'rev-parse HEAD': 'deadbeef',
      'rev-parse --abbrev-ref HEAD': 'main',
      'status --porcelain --untracked-files=no': '',
    }
    const info = collectBuildInfo((_cmd, args) => {
      calls.push(args.join(' '))
      return answers[args.join(' ')]
    })

    // 未跟踪的 start_service.sh、签名包常年躺在部署机上；把它们算成「脏」会让
    // 这个字段永远是 true，核对时就再也看不出「产物不对应任何提交」这个真问题
    expect(calls).toContain('status --porcelain --untracked-files=no')
    expect(info.dirty).toBe(false)
  })

  it('取不到 git（无 git 或不是仓库）时不抛错，commit 记 null', () => {
    const run = () => {
      throw new Error('git not found')
    }
    const info = collectBuildInfo(run)
    expect(info.commit).toBe(null)
    expect(info.branch).toBe(null)
    expect(info.dirty).toBe(null)
    // 构建来源采不到不该阻断构建，仍然要落下构建时刻
    expect(typeof info.builtAt).toBe('string')
  })

  it('写入产物文件后能原样读回', async () => {
    const dir = await tempDist()
    const info = {
      commit: 'c0ffee',
      branch: 'main',
      dirty: false,
      builtAt: '2026-11-26T09:00:00.000Z',
    }
    await writeBuildInfo(dir, info)
    expect(await readBuildInfo(dir)).toEqual(info)
  })
})

describe('/api/health 报出构建来源', () => {
  it('产物里有构建来源时随健康检查一起返回', async () => {
    const dir = await tempDist()
    await writeBuildInfo(dir, {
      commit: 'abc1234',
      branch: 'main',
      dirty: false,
      builtAt: '2026-11-26T09:00:00.000Z',
    })

    const running = await serve(dir)
    const body = await (await fetch(`${running.base}/api/health`)).json()
    await running.close()

    expect(body.configured).toBe(true)
    expect(body.build).toEqual({
      commit: 'abc1234',
      branch: 'main',
      dirty: false,
      builtAt: '2026-11-26T09:00:00.000Z',
    })
  })

  it('产物里没有构建来源时 build 为 null，健康检查照常 200', async () => {
    const dir = await tempDist()
    const running = await serve(dir)
    const response = await fetch(`${running.base}/api/health`)
    const body = await response.json()
    await running.close()

    expect(response.status).toBe(200)
    expect(body.build).toBe(null)
  })
})
