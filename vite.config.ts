import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx', 'tests/**/*.test.mjs'],
  },
  server: {
    // nginx 把 8787 转给外部域名，dev server 占住这个端口就不必改 nginx
    host: '127.0.0.1',
    port: 8787,
    strictPort: true,
    // 经 nginx 反代访问时 Host 是站点域名，不放行会被 vite 拦成 403
    allowedHosts: ['study.sii.edu.cn', 'localhost', '127.0.0.1'],
    proxy: {
      // API 让出 8787 给 dev server，自身后移到 8788
      '/api': 'http://127.0.0.1:8788',
    },
  },
})
