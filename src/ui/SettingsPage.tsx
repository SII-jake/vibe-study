import type { ServerHealth } from '../ai/health'
import { loadModelPreference, saveModelPreference } from '../ai/preferences'

export interface SettingsPageProps {
  health: ServerHealth
  onRefreshHealth(): void
  onBack(): void
}

/** 设置页只展示服务端能力并选择模型；密钥由服务端保管，浏览器无从访问。 */
export function SettingsPage({ health, onRefreshHealth, onBack }: SettingsPageProps) {
  const preferred = loadModelPreference()
  const choices = health.models.length > 0 ? health.models : health.model ? [health.model] : []

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
      </div>
    </div>
  )
}
