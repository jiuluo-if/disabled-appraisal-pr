import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig(({ mode }) => {
  const backendEnv = loadEnv(mode, resolve(import.meta.dirname, 'gemini'), ['PORT']);
  const backendPort = process.env.PORT || backendEnv.PORT || '3000';
  const proxyTarget = process.env.DEV_API_URL || `http://127.0.0.1:${backendPort}`;

  return {
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
        target: proxyTarget,
        secure: proxyTarget.startsWith('https://') && !/^https:\/\/(127\.0\.0\.1|localhost):/.test(proxyTarget),
      } },
    },
  };
});
