import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  return {
    // './' base is required for Capacitor — assets must use relative paths
    // so they resolve correctly inside the native WebView shell
    base: './',
    server: {
      port: 3000,
      host: '0.0.0.0',
    },
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      }
    },
    build: {
      // Ensure sourcemaps for debugging on device
      sourcemap: false,
      // Capacitor WebView works best with these settings
      target: 'es2015',
    },
  };
});
