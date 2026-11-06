import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// 线上用 `vite preview` 提供服务，端口由 PORT 注入；本地桌面开发固定 5188
const PORT = process.env.PORT ? Number(process.env.PORT) : 5188

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],
  // 桌面版从自定义协议加载，必须用相对路径
  base: mode === 'production' ? './' : '/',
  server: {
    port: PORT,
    host: '0.0.0.0',
    strictPort: false,
    allowedHosts: true,
  },
  preview: {
    port: PORT,
    host: '0.0.0.0',
    strictPort: false,
    allowedHosts: true,
  },
}))
