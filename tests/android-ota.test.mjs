// Android OTA 配置守护：安装权限与 FileProvider 就位，壳内更新才能拉起系统安装器。
// 原生出问题（权限漏配/Provider 丢失）时 e2e 抓不到，这里把红线钉在仓库里。
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = readFileSync(join(repoRoot, 'android/app/src/main/AndroidManifest.xml'), 'utf8')
const mainActivity = readFileSync(
  join(repoRoot, 'android/app/src/main/java/cn/sii/yjzhou/vibestudy/MainActivity.java'),
  'utf8',
)

describe('AndroidManifest：旁路安装声明', () => {
  it('声明 REQUEST_INSTALL_PACKAGES 权限（拉起 APK 安装器的前提）', () => {
    expect(manifest).toContain('android.permission.REQUEST_INSTALL_PACKAGES')
  })

  it('保留 FileProvider 声明（安装器读取下载的 APK 需要 content:// URI）', () => {
    expect(manifest).toContain('androidx.core.content.FileProvider')
  })
})

describe('MainActivity：VibeAppUpdate 原生桥就位', () => {
  it('向 WebView 注册 VibeAppUpdate 桥对象', () => {
    expect(mainActivity).toContain('addJavascriptInterface')
    expect(mainActivity).toContain('VibeAppUpdate')
  })

  it('桥暴露版本与更新入口：getVersionCode / getVersionName / hasUpdatePermission / downloadAndInstall', () => {
    for (const method of ['getVersionCode', 'getVersionName', 'hasUpdatePermission', 'openUpdatePermissionSettings', 'downloadAndInstall']) {
      expect(mainActivity, `缺少 ${method}`).toContain(`${method}(`)
    }
  })
})
