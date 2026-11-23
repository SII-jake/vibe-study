/**
 * 写 dist/app/update-policy.json（强制更新底线的唯一写入方）。
 *
 * 用法：node scripts/write-update-policy.mjs <versionName> [--mandatory]
 *
 * 每版发布带一个「是否强制更新」状态：--mandatory 表示本版有与服务端不兼容的
 * 改动，低于本版 versionCode 的客户端必须装完才能进入应用；不带该参数则是可选
 * 更新，用户有空再装。底线只升不降（算法见 nextMinVersionCode）。
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { nextMinVersionCode } from '../server/app-version.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const versionName = process.argv[2]
const mandatory = process.argv.includes('--mandatory')
if (!/^\d+\.\d+(\.\d+)*$/.test(versionName ?? '')) {
  console.error(`版本名无法识别：${versionName ?? '(空)'}`)
  process.exit(1)
}

const appDir = join(repoRoot, 'dist', 'app')
const policyPath = join(appDir, 'update-policy.json')
let current = 0
try {
  current = JSON.parse(await readFile(policyPath, 'utf8'))?.minVersionCode ?? 0
} catch {
  // 首次发布或文件损坏：按从未设过底线处理，算法内部还会再兜一次
}

const minVersionCode = nextMinVersionCode(current, versionName, mandatory)
await mkdir(appDir, { recursive: true })
await writeFile(
  policyPath,
  `${JSON.stringify({ minVersionCode, mandatory, versionName }, null, 2)}\n`,
  'utf8',
)
console.log(
  mandatory
    ? `强制更新：minVersionCode=${minVersionCode}（低于此版本的客户端必须更新）`
    : `可选更新：minVersionCode=${minVersionCode}（保持既有底线，不强制任何人）`,
)
