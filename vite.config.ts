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
    // Horodatage du build : une alerte de capacité acquittée ne se rouvre
    // que si un build POSTÉRIEUR à l'acquittement retouche le plafond.
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  publicDir: 'public',
  build: {
    rollupOptions: {
      external: [],
    },
    copyPublicDir: true,
  },
});
