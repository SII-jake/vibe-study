import { useState } from 'react'
import { isConfigured, loadConfig, saveConfig } from '../ai/settings'

export interface SettingsPageProps {
  onBack(): void
}

const PRESETS = [
  { label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { label: '智谱', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' },
  { label: '通义', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
  { label: 'Kimi', baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
]

const CONFIGURED_HINT = '接口已就绪。'

export function SettingsPage({ onBack }: SettingsPageProps) {
  const [config, setConfig] = useState(loadConfig)
  const [saved, setSaved] = useState(false)

  const patch = (next: Partial<typeof config>) => {
    setConfig({ ...config, ...next })
    setSaved(false)
  }

  const save = () => {
    saveConfig(config)
    setConfig(loadConfig())
    setSaved(true)
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
        <label className="field">
          <span>接口地址</span>
          <input
            type="url"
            inputMode="url"
            value={config.baseUrl}
            onChange={(event) => patch({ baseUrl: event.target.value })}
          />
        </label>

        <label className="field">
          <span>API Key</span>
          <input
            type="password"
            value={config.apiKey}
            onChange={(event) => patch({ apiKey: event.target.value })}
          />
        </label>

        <label className="field">
          <span>模型名</span>
          <input
            type="text"
            value={config.model}
            onChange={(event) => patch({ model: event.target.value })}
          />
        </label>

        <div className="preset-row">
          {PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              className="btn-ghost"
              onClick={() => patch({ baseUrl: preset.baseUrl, model: preset.model })}
            >
              {preset.label}
            </button>
          ))}
        </div>

        <button type="button" className="btn-primary" onClick={save}>
          保存
        </button>

        <p className="hint">
          {saved && isConfigured(config) ? CONFIGURED_HINT : '密钥只保存在这台手机的浏览器本地。'}
        </p>
        <p className="hint">
          浏览器直接请求模型接口需要对方允许跨域；被拦时请用自建代理或带 CORS 的网关地址。
        </p>
      </div>
    </div>
  )
}
