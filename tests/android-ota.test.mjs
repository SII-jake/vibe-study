// Android OTA 配置守护：安装权限与 FileProvider 就位，壳内更新才能拉起系统安装器。
// 原生出问题（权限漏配/Provider 丢失）时 e2e 抓不到，这里把红线钉在仓库里。
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = readFileSync(join(repoRoot, 'android/app/src/main/AndroidManifest.xml'), 'utf8')
const filePaths = readFileSync(
  join(repoRoot, 'android/app/src/main/res/xml/file_paths.xml'),
  'utf8',
)
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

describe('OTA 安装路径（真机反馈：下载完不弹安装界面）', () => {
  it('file_paths.xml 声明 external-files-path——FileProvider 才能包了应用专属下载目录', () => {
    // 下载目标是 getExternalFilesDir(DIRECTORY_DOWNLOADS)，仅 external-path/cache-path
    // 的声明会让 getUriForFile 抛 IllegalArgumentException，安装器永远拉不起来
    expect(filePaths).toContain('external-files-path')
  })
})

describe('OTA 下载链路（真机反馈：系统下载器不认自签证书，下载永远完不成）', () => {
  it('下载收进 App 进程内：18003 自签证书由壳一对一钉证', () => {
    expect(mainActivity).toContain('downloadInProcess')
    expect(mainActivity).toContain('pinnedSslSocketFactory')
    expect(mainActivity).toContain('pinnedHostnameVerifier')
    expect(mainActivity).toContain('TRUSTED_CERT_SHA256')
  })

  it('下载进度回填启动页：读 Content-Length 并发 vibe-ota-progress', () => {
    // 真机反馈：只有一行"下载中"，看不出在不在动。原生侧必须上报真实字节数，
    // 且总量取自响应头而不是猜；拿不到总量时上报 -1，由启动页退化成"已下载量"。
    expect(mainActivity).toContain('notifyOtaProgress')
    expect(mainActivity).toContain('getContentLengthLong')
    expect(mainActivity).toContain('vibe-ota-progress')
  })

  it('系统 DownloadManager 整段退役（它在 App 进程外，WebView 放行管不到）', () => {
    expect(mainActivity).not.toContain('DownloadManager')
    expect(mainActivity).not.toContain('ACTION_DOWNLOAD_COMPLETE')
  })

  it('下载失败发 vibe-ota-failed 事件给启动页（不再傻等不弹的安装界面）', () => {
    expect(mainActivity).toContain('vibe-ota-failed')
    expect(mainActivity).toContain('notifyOtaFailed')
  })

  it('启动页对失败态有兜底：download-failed 状态与 vibe-ota-failed 监听', () => {
    const bootJs = readFileSync(join(repoRoot, 'android-shell/boot.js'), 'utf8')
    const bootHtml = readFileSync(join(repoRoot, 'android-shell/index.html'), 'utf8')
    expect(bootJs).toContain('download-failed')
    expect(bootHtml).toContain('vibe-ota-failed')
  })
})

describe('versionCode 与 versionName 同算法（真机反馈：装上新版仍重复提示更新）', () => {
  it('build.gradle 的 versionCode 从 versionName 派生——不写死版本字面量', () => {
    // 1.0.8→1.0.13 全部包的 APK 内部 versionCode 都是 10007000（semParts 硬编码
    // "1.0.7"）：服务器发 10013000 与桥读 10007000 永远"小于"，装多少遍都提示更新。
    // 钉死：semParts 来源必须是 versionName.split，不许出现硬编码 semver 字面量。
    const gradle = readFileSync(join(repoRoot, 'android/app/build.gradle'), 'utf8')
    expect(gradle).toContain('versionName.split')
    expect(gradle).not.toMatch(/semParts\s*=\s*"\d+\.\d+\.\d+"/)
  })
})
