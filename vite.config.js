import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        injury: resolve(import.meta.dirname, 'analyst.lintsing.net/index.html'),
        disability: resolve(import.meta.dirname, 'appraise.lintsing.net/index.html'),
      },
    },
  },
  server: {
    proxy: { '/api': {
      target: process.env.DEV_API_URL || 'https://127.0.0.1:3000',
      secure: Boolean(process.env.DEV_API_URL && !/^https:\/\/(127\.0\.0\.1|localhost):/.test(process.env.DEV_API_URL)),
    } },
  },
});
