/**
 * 构建来源：把「这份 dist 是从哪个 git commit 编译出来的」记进产物，供 /api/health 核对。
 *
 * 口径要点：commit 在**构建时**由采集脚本写入 dist/build-info.json，运行时只读产物，
 * 绝不在运行时跑 git。原因：线上跑的是「git pull && npm run build」的循环，
 * 构建失败时进程照样起来、继续服务旧 dist。若运行时去问 git，HEAD 已经前进，
 * 报出来的会是新 commit——恰好把「旧产物冒充新版本」这个要抓的场景报成正常。
 * 只有构建那一刻记下的 commit，才真正代表这份产物。
 */
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** 产物内的文件名；与 dist/ 同级，随 dist 一起被清扫与部署。 */
export const BUILD_INFO_FILE = 'build-info.json'

/** 默认采集通道：直接问 git。取不到（没装 git / 不在仓库里）由调用方兜住。 */
const readGit = (_cmd, args) =>
  execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()

/**
 * 采集构建来源。run 可注入：测试用固定答案，避免依赖当前仓库状态。
 * 取不到 git 时不抛错——构建来源是核对信息，不该阻断构建。
 */
export function collectBuildInfo(run = readGit, now = () => new Date().toISOString()) {
  const ask = (args) => {
    try {
      return run('git', args)
    } catch {
      return null
    }
  }
  const commit = ask(['rev-parse', 'HEAD'])
  const branch = ask(['rev-parse', '--abbrev-ref', 'HEAD'])
  /**
   * dirty 表示「构建时已跟踪文件有改动」：这种产物不对应任何一个提交，核对时要能看出来。
   * 刻意排除未跟踪文件（--untracked-files=no）：部署机上常年躺着 start_service.sh、
   * 签名包这类运维文件，把它们算成「脏」会让这个字段永远为 true，真正该报警的
   * 「产物不对应任何提交」就再也看不出来了。
   */
  const status = ask(['status', '--porcelain', '--untracked-files=no'])
  return {
    commit: commit || null,
    branch: branch || null,
    dirty: status === null ? null : status !== '',
    builtAt: now(),
  }
}

/** 把构建来源写进产物目录（构建脚本收尾调用）。 */
export async function writeBuildInfo(distRoot, info) {
  await mkdir(distRoot, { recursive: true })
  await writeFile(join(distRoot, BUILD_INFO_FILE), JSON.stringify(info, null, 2))
}

/**
 * 读产物里的构建来源。文件缺失（老产物）或损坏一律回 null ——
 * 如实报「不知道」，绝不拿运行时 HEAD 顶替，也绝不因此让健康检查 500。
 */
export async function readBuildInfo(distRoot) {
  let raw
  try {
    raw = await readFile(join(distRoot, BUILD_INFO_FILE), 'utf8')
  } catch {
    return null
  }
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') {
    return null
  }
  return parsed
}
