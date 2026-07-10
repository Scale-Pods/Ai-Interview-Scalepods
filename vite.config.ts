import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') }
  },
  server: {
    proxy: {
      '/api': 'http://localhost:5678',
      '/webhook': {
        target: 'https://n8n.srv1010832.hstgr.cloud',
        changeOrigin: true,
        secure: false
      }
    }
  }
})
