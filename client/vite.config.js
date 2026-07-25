import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Inside Docker, use service name; locally use localhost
const backendTarget = process.env.BACKEND_URL || 'http://localhost:5000'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    host: '0.0.0.0',
    proxy: {
      '/api': {
        target: backendTarget,
        changeOrigin: true,
      }
    }
  }
})
