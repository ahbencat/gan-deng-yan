import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // 子路径部署：BASE_PATH=/just_look/ npm run build（默认根路径）
  base: process.env.BASE_PATH || '/',
  plugins: [vue()],
  server: {
    port: 5174,
    host: true, // 监听 0.0.0.0，局域网设备可访问
    proxy: {
      // 开发时把 /api、/ws、/admin 转发到后端，避免跨域
      '/api': 'http://localhost:3002',
      '/admin': 'http://localhost:3002',
      '/ws': {
        target: 'ws://localhost:3002',
        ws: true,
      },
    },
  },
})
