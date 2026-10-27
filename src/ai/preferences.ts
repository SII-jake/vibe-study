/** 客户端偏好：只存模型名这类非敏感选择，密钥一律不落到浏览器。 */

const MODEL_KEY = 'vibe-study.model'

export function loadModelPreference(): string {
  try {
    return (localStorage.getItem(MODEL_KEY) ?? '').trim()
  } catch {
    return ''
  }
}

export function saveModelPreference(model: string): void {
  try {
    if (model.trim() === '') localStorage.removeItem(MODEL_KEY)
    else localStorage.setItem(MODEL_KEY, model.trim())
  } catch {
    // 隐私模式下写入被拒时退回服务端默认模型。
  }
}
