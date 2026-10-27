import type { CapacitorConfig } from '@capacitor/cli'

/**
 * 远程壳模式：APK 内的 WebView 直接加载 https://study.sii.edu.cn。
 * 页面、密钥、agent 工具链全部留在服务端，改前端重新部署服务端即可，APK 不需要重打。
 */
const config: CapacitorConfig = {
  appId: 'cn.sii.yjzhou.vibestudy',
  appName: 'vibe study',
  // 壳内只打包启动页；服务器地址由启动页保存，不进构建产物。
  webDir: 'android-shell',
  server: {
    // 启动页允许把 WebView 导向任意服务器地址（用户自配的服务器难免是未知主机）。
    // 源码依据：HostMask "*" 通配任意 host，命中 allowNavigation 的导航留在壳内，
    // 否则会被甩到系统浏览器。
    allowNavigation: ['*'],
  },
  android: {
    allowMixedContent: false,
  },
}

export default config
