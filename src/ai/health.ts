import { loadModelPreference } from './preferences'

/** 服务端就绪状态；密钥是否存在只由服务端回答，前端无从得知。 */
export interface ServerHealth {
  configured: boolean
  model: string
  models: string[]
}

export const UNKNOWN_HEALTH: ServerHealth = { configured: false, model: '', models: [] }

export async function fetchHealth(fetchImpl: typeof fetch = fetch): Promise<ServerHealth> {
  try {
    const response = await fetchImpl('/api/health')
    if (!response.ok) return UNKNOWN_HEALTH
    const body = (await response.json()) as Partial<ServerHealth>
    return {
      configured: body.configured === true,
      model: (body.model ?? '').trim(),
      models: Array.isArray(body.models) ? body.models.filter((item) => typeof item === 'string') : [],
    }
  } catch {
    return UNKNOWN_HEALTH
  }
}

/** 客户端选中的模型仅在服务端白名单内生效，否则退回服务端默认模型。 */
export function effectiveModel(health: ServerHealth): string {
  const preferred = loadModelPreference()
  return health.models.includes(preferred) ? preferred : health.model
}
