import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * 开发环境：
 *   npm run dev                 → API 127.0.0.1:3001 + Web 127.0.0.1:5173
 * 如需临时切换端口（多人并行联调）：
 *   $env:DEV_API_URL='http://127.0.0.1:3011'; $env:WEB_PORT='5174'; npm run dev:web
 */
const apiTarget = process.env.DEV_API_URL || 'http://127.0.0.1:3001';
const webPort = Number(process.env.WEB_PORT || 5173);

export default defineConfig({
  plugins: [react()],
  server: {
    port: webPort,
    strictPort: true,
    proxy: { '/api': apiTarget },
  },
  build: {
    outDir: 'dist',
    // 世界地图几何 JSON 约 1.1MB，作为独立 chunk 加载；提高告警阈值避免噪音
    chunkSizeWarningLimit: 1800,
  },
});
