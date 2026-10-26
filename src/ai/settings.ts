/** 模型接口配置：OpenAI 兼容协议的三个必要参数，仅保存在本机。 */

export interface AiConfig {
  baseUrl: string
  apiKey: string
  model: string
}

const STORAGE_KEY = 'vibe-study.ai-config'

export const DEFAULT_CONFIG: AiConfig = {
  baseUrl: 'https://api.deepseek.com/v1',
  apiKey: '',
  model: 'deepseek-chat',
}

/** 归一化接口地址：去尾斜杠；裸域名补 `/v1`，已带版本段的不再追加。 */
export function normalizeBaseUrl(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, '')
  if (trimmed === '') return ''
  return /\/v\d+$/.test(trimmed) || /\/api\/\w+\/v\d+$/.test(trimmed) ? trimmed : `${trimmed}/v1`
}

export function normalizeConfig(input: Partial<AiConfig> | null | undefined): AiConfig {
  return {
    baseUrl: normalizeBaseUrl(input?.baseUrl ?? ''),
    apiKey: (input?.apiKey ?? '').trim(),
    model: (input?.model ?? '').trim(),
  }
}

export function isConfigured(config: AiConfig): boolean {
  return config.apiKey !== '' && config.model !== ''
}

export function loadConfig(): AiConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_CONFIG
    return normalizeConfig(JSON.parse(raw) as Partial<AiConfig>)
  } catch {
    return DEFAULT_CONFIG
  }
}

export function saveConfig(config: AiConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeConfig(config)))
}
