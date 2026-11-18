// Android 自签证书放行护栏（真实手机实测缺陷修复）：
// 8.153.198.42:18003 的人机部署 TLS 是自签证书，Android WebView 默认对不受信
// 证书静默断连——手机端选这个地址"完全没有反应"（无任何报错）。壳必须显式放
// 行"预设 host + 证书指纹双匹配"的那一台，其余 SSL 错误照常拦截。
// 原生出问题 e2e 抓不到（连能面前的 shell 都爬不起），红线钉在仓库里。
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const mainActivity = readFileSync(
  join(repoRoot, 'android/app/src/main/java/cn/sii/yjzhou/vibestudy/MainActivity.java'),
  'utf8',
)

describe('MainActivity：自签服务白名单放行', () => {
  it('重载 WebViewClient.onReceivedSslError（修复 WebView 静默断连的点）', () => {
    expect(mainActivity).toContain('onReceivedSslError')
  })

  it('放行今凭"host + 证书指纹双匹配"收紧，不是 error.proceed() 无条件放行', () => {
    expect(mainActivity).toContain('TRUSTED_HOST')
    expect(mainActivity).toContain('TRUSTED_CERT_SHA256')
    expect(mainActivity).toContain('handler.proceed()')
    expect(mainActivity).toContain('handler.cancel()')
  })

  it('预设信任的是新建新机器的 IP 与实测指纹，不是泛化模式', () => {
    expect(mainActivity).toContain('8.153.198.42')
    expect(mainActivity).toContain('AF:3C:B1:3C:97:89:3C:F6:41:6F:C8:A7:30:93:D7:30:1B:D9:1E:16:06:E1:83:0F:00:ED:D6:EE:0C:0A:86:83')
  })
})
