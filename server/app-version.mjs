/**
 * /api/app-version：远端壳检查更新的唯一口径。
 *
 * 数据归属：发布的 APK 放在静态目录 dist/app/ 下（由 scripts/publish-apk.sh
 * 拷贝）；本端点只读 dist/，不回读 android/ 或仓库任何其他位置 ——
 * 版本号以服务端的文件为准，壳不猜、不兜底。
 */
import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

/** 从 APK 文件名解版本：vibe-study-<versionName>-<buildType>.apk；无法识别时兜底。 */
export function parseApkName(name) {
  const match = /^.+-(\d+\.\d+(?:\.\d+)?(?:\.\d+)?)-(?:release|debug)\.apk$/.exec(name)
  if (match) return match[1]
  return '0.0.0'
}

/**
 * 版本号 → 单调递增加 versionCode。约定：versionName 数字段按位放大拼整数
 * （「1.2.31」→ 102031），与 build.gradle 中 bump 的 versionCode 保持同序可比。
 * 这是服务端唯一把名字变成比较数的地方；壳拿它与桥取到的当前 code 比。
 */
export function versionCodeOf(versionName) {
  const parts = versionName.split('.').map((piece) => Number.parseInt(piece, 10))
  if (parts.some((piece) => !Number.isInteger(piece) || piece < 0)) return 0
  const [major = 0, minor = 0, patch = 0, build = 0] = parts
  return major * 10000000 + minor * 100000 + patch * 1000 + build
}

/**
 * 扫 dist/app/ 找最新发布的 APK。目录不存在 / 没有 APK → null（壳静默放行）。
 * 同目录多个 APK 时取 versionCode 最大的（publishing 脚本只留一份，防御多份）。
 */
export async function readPublishedApk(distRoot) {
  const appDir = join(distRoot, 'app')
  let entries
  try {
    entries = await readdir(appDir)
  } catch {
    return null
  }
  const apks = entries.filter((name) => name.toLowerCase().endsWith('.apk'))
  if (apks.length === 0) return null

  const candidates = []
  for (const apkName of apks) {
    const file = await readFile(join(appDir, apkName))
    const versionName = parseApkName(apkName)
    candidates.push({
      versionName,
      versionCode: versionCodeOf(versionName),
      apkName,
      sha256: createHash('sha256').update(file).digest('hex'),
    })
  }
  candidates.sort((a, b) => b.versionCode - a.versionCode)
  return candidates[0]
}

/** JSON：{ versionName, versionCode, apkName, sha256 }；无 APK → 404。 */
export function createAppVersionHandler(distRoot) {
  return async function serveAppVersion(request, response) {
    // 壳内启动页源是 https://localhost（Capacitor WebView 本地源），
    // 跨源 fetch 必须拿到 CORS 头，否则 checkAppUpdate 静默放行、启动页无任何提示。
    // 该接口无任何密钥/用户数据，任意源放行是安全口径。
    const headers = {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, headers)
      response.end('方法不被允许')
      return
    }
    // 服务端版本：dist/server-version.json（发布脚本每次自增）；
    // 老部署无此文件时回退壳版本（info 取不到就用 0.0.0 兜底），口径不双轨。
    const info = await readPublishedApk(distRoot)
    const serverVersion = await readServerVersion(distRoot, info?.versionName ?? '0.0.0')
    if (!info) {
      // 纯前端发布（无新 APK）也要报服务端版本：它是与壳版本并列的第二口径，
      // 设置页据此让用户看见「服务在前进」，不能用 404 一体装死。
      response.writeHead(404, headers)
      response.end(JSON.stringify({ error: 'no apk published', serverVersion }))
      return
    }
    response.writeHead(200, headers)
    response.end(JSON.stringify({ ...info, serverVersion }))
  }
}

/**
 * 从 dist/server-version.json 读服务端版本（发布脚本每次自增）。
 * 老部署尚无该文件：回退 fallback（调用方传壳版本），新旧口径无缝衔接。
 */
export async function readServerVersion(distRoot, fallback = '0.0.0') {
  try {
    const parsed = JSON.parse(await readFile(join(distRoot, 'server-version.json'), 'utf8'))
    const version = typeof parsed.version === 'string' ? parsed.version.trim() : ''
    return /^\d+\.\d+\.\d+(\.\d+)?$/.test(version) ? version : fallback
  } catch {
    return fallback
  }
}
