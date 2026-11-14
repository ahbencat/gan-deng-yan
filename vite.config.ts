import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5174,
    host: true, // 监听 0.0.0.0，局域网设备可访问
    proxy: {
      // 开发时把 /api 与 /ws 转发到后端，避免跨域
      '/api': 'http://localhost:3002',
      '/ws': {
        target: 'ws://localhost:3002',
        ws: true,
      },
    },
  },
})
