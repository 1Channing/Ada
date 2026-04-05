import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import pkg from './package.json';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  publicDir: 'public',
  build: {
    rollupOptions: {
      external: [],
    },
    copyPublicDir: true,
  },
});
