import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, '');
  const backendUrl = env.VITE_BACKEND_URL || 'http://127.0.0.1:5000';
  const apiProxy = {
    '/api': { target: backendUrl, changeOrigin: true },
  };

  return {
    plugins: [react()],
    base: './',
    root: path.resolve(__dirname),
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      assetsDir: 'assets',
    },
    server: {
      host: '0.0.0.0',
      port: 5173,
      strictPort: true,
      proxy: apiProxy,
    },
    preview: {
      host: '0.0.0.0',
      port: 5173,
      proxy: apiProxy,
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
      },
    },
  };
});
