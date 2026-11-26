/**
 * 写 dist/build-info.json：把「这份产物由哪次提交编译而来」钉在产物里。
 *
 * 用法：npm run build 收尾自动执行；也可单跑 node scripts/write-build-info.mjs。
 *
 * 为什么必须在构建期写、而不是运行时问 git：线上是「git pull && npm run build」
 * 的自更新循环，构建失败时进程照样起来、继续服务旧 dist。运行时问 git 得到的是
 * 已前进的 HEAD，会把旧产物冒充成新版本——恰好把这个要抓的场景报成正常。
 */
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { collectBuildInfo, writeBuildInfo } from '../server/build-info.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const distDir = process.env.DIST_DIR ?? join(repoRoot, 'dist')

const info = collectBuildInfo()
await writeBuildInfo(distDir, info)

if (info.commit === null) {
  // 采集不到 git 不阻断构建（用户可能只是解压了一份源码在编译），但要显式说出来，
  // 免得事后对着 null 猜「是没写进去还是真的不知道」。
  console.warn('[build-info] 取不到 git 信息，commit 记为 null（构建继续）')
} else {
  console.log(
    `[build-info] commit ${info.commit.slice(0, 8)}${info.dirty ? '（工作区有未提交改动）' : ''} → ${join(distDir, 'build-info.json')}`,
  )
}
