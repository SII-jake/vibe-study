import { useEffect, useState } from 'react'
import type { ServerHealth } from '../ai/health'
import { loadModelPreference, saveModelPreference } from '../ai/preferences'
import {
  checkInstalledAppUpdate,
  currentVersionLabel,
  fetchServerVersion,
  hasUpdateBridge,
  type AppUpdateResult,
} from './app-update-check'

export interface SettingsPageProps {
  health: ServerHealth
  onRefreshHealth(): void
  onBack(): void
}

/** 更新检查结果翻译成用户可见文案；每种状态都要有落地文案，不许静默。 */
function updateStatusText(result: AppUpdateResult): string {
  switch (result.kind) {
    case 'no-update':
      return '服务器尚未发布安装包。'
    case 'up-to-date':
      return `已是最新版本（${result.current}）。`
    case 'need-permission':
      return `发现新版本 ${result.versionName}，已打开系统设置：请允许本应用安装未知来源应用后回来重试。`
    case 'downloading':
      return `发现新版本 ${result.versionName}，更新包下载中，完成后请在弹出的安装界面点「安装」。`
    case 'failed':
      return result.reason === 'no-bridge'
        ? '当前不在 Android 应用内，无法检查应用更新。'
        : `检查更新失败：${result.reason}`
  }
}

/** 设置页只展示服务端能力并选择模型；密钥由服务端保管，浏览器无从访问。 */
export function SettingsPage({ health, onRefreshHealth, onBack }: SettingsPageProps) {
  const preferred = loadModelPreference()
  const choices = health.models.length > 0 ? health.models : health.model ? [health.model] : []
  const [update, setUpdate] = useState<
    { phase: 'idle' } | { phase: 'checking' } | { phase: 'done'; result: AppUpdateResult }
  >({ phase: 'idle' })
  // 服务端版本与应用版本并列展示：壳没变的服务端前进（纯前端发布）也要看得见
  const [serverVersion, setServerVersion] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void fetchServerVersion().then((version) => {
      if (alive) setServerVersion(version)
    })
    return () => {
      alive = false
    }
  }, [])

  const runUpdateCheck = () => {
    setUpdate({ phase: 'checking' })
    void checkInstalledAppUpdate().then((result) => setUpdate({ phase: 'done', result }))
  }

  return (
    <div className="page">
      <header className="reader-head">
        <button type="button" className="icon-btn" onClick={onBack} aria-label="返回">
          ←
        </button>
        <div className="reader-crumb">
          <span className="crumb-current">设置</span>
        </div>
        <span className="icon-btn" />
      </header>

      <div className="settings">
        <div className="status-row">
          <span className={`status-dot ${health.configured ? 'status-ok' : 'status-bad'}`} />
          <span>{health.configured ? '服务端已就绪' : '服务端未配置模型接口'}</span>
          <button type="button" className="btn-ghost status-refresh" onClick={onRefreshHealth}>
            刷新
          </button>
        </div>

        {choices.length > 0 && (
          <div className="field">
            <span>模型</span>
            <div className="preset-row">
              {choices.map((model) => (
                <button
                  key={model}
                  type="button"
                  className={`btn-ghost ${model === (preferred || health.model) ? 'chip-active' : ''}`}
                  onClick={() => {
                    saveModelPreference(model)
                    onRefreshHealth()
                  }}
                >
                  {model}
                </button>
              ))}
            </div>
          </div>
        )}

        <p className="hint">密钥保存在服务端，浏览器与前端代码都拿不到。</p>
        <p className="hint">
          改上游地址或密钥需要编辑服务端的 server/.env，改完重启服务进程生效。
        </p>

        <div className="field">
          <span>{hasUpdateBridge() ? '应用更新' : '服务端'}</span>
          {hasUpdateBridge() && (
            <div className="status-row">
              <span>应用版本 {currentVersionLabel()}</span>
              <button
                type="button"
                className="btn-ghost status-refresh"
                disabled={update.phase === 'checking'}
                onClick={runUpdateCheck}
              >
                {update.phase === 'checking' ? '检查中…' : '检查更新'}
              </button>
            </div>
          )}
          <div className="status-row">
            <span>服务端版本 {serverVersion ?? '获取中…'}</span>
          </div>
          {hasUpdateBridge() && update.phase === 'done' && (
            <p className="hint update-status">{updateStatusText(update.result)}</p>
          )}
        </div>
      </div>
    </div>
  )
}
