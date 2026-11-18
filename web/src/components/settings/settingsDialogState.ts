import { create } from 'zustand'

/** 设置弹窗的分组：通用设置 / 数据管理 */
export type SettingsSection = 'general' | 'data'

/** 设置弹窗：侧边栏底部、没有 API Key 时的操作与 401 提示都可以打开；section 为打开时选中的分组 */
export const useSettingsDialog = create(() => ({
  open: false,
  section: 'general' as SettingsSection,
}))

export const openSettings = (section: SettingsSection) =>
  useSettingsDialog.setState({ open: true, section })

export const closeSettings = () => useSettingsDialog.setState({ open: false })

/**
 * 鉴权是否就绪。
 * vibe-study 服务端托管模式：聊天走服务端同源代理（/anthropic/v1/*），密钥由后端注入，
 * 客户端无需持有 API Key —— 因此恒为就绪；设置页仍可打开，仅用于管理数据与偏好。
 */
export const ensureApiKey = () => {
  return true
}
