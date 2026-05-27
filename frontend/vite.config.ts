import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import path from 'path';

process.env.VITE_APP_TITLE ??= process.env.OVERVIEW_TITLE ?? 'بلاغات صيانة محافظة مبارك الكبير';
process.env.VITE_APP_DESCRIPTION ??= process.env.OVERVIEW_DESCRIPTION ?? 'نظام إدارة بلاغات صيانة المساجد - محافظة مبارك الكبير';
process.env.VITE_APP_LOGO_URL ??= process.env.OVERVIEW_LOGO_URL ?? '/icons/icon-192x192.svg';

// Inject build timestamp for version tracking (helps identify deployed builds)
const BUILD_TIMESTAMP = new Date().toISOString();
const BUILD_VERSION = `v${Date.now().toString(36)}`;

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  define: {
    __BUILD_TIMESTAMP__: JSON.stringify(BUILD_TIMESTAMP),
    __BUILD_VERSION__: JSON.stringify(BUILD_VERSION),
  },
  plugins: [
    react(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // Force every import of react/react-dom to resolve to the exact same copy.
      // This prevents "Cannot read properties of null (reading 'useContext')" that
      // occurs when react-router-dom is pre-bundled against a different React instance.
      react: path.resolve(__dirname, './node_modules/react'),
      'react-dom': path.resolve(__dirname, './node_modules/react-dom'),
    },
    dedupe: ['react', 'react-dom', 'react-router', 'react-router-dom', 'scheduler'],
  },
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react-dom/client',
      'react-router-dom',
      'react-router-dom > react-router',
      'react/jsx-runtime',
      'react/jsx-dev-runtime',
      'scheduler',
    ],
    force: true,
  },
  server: {
    host: '0.0.0.0', // 监听所有网络接口
    port: parseInt(process.env.VITE_PORT || '3000'),
    proxy: {
      '/api': {
        target: `http://localhost:8001`,
        changeOrigin: true,
      },
      // Forward static uploaded files (attendance images, etc.) to the backend
      // StaticFiles mount. Without this, opening "/uploads/..." in dev mode hits
      // the Vite SPA and returns the app's 404 page.
      '/uploads': {
        target: `http://localhost:8001`,
        changeOrigin: true,
      },
    },
    watch: { usePolling: true, interval: 600 },
  },
  build: {
    rollupOptions: {
      output: {
        // Keep React, React-DOM, and React-Router-DOM together to guarantee
        // a single React instance is shared across all chunks. Splitting them
        // can lead to "Cannot read properties of null (reading 'useContext')"
        // errors when react-router-dom resolves to a different React copy.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;

          // All React-related libs share one chunk
          if (
            id.includes('/node_modules/react/') ||
            id.includes('/node_modules/react-dom/') ||
            id.includes('/node_modules/react-router/') ||
            id.includes('/node_modules/react-router-dom/') ||
            id.includes('scheduler')
          ) {
            return 'react-vendor';
          }

          if (id.includes('/node_modules/@radix-ui/')) return 'ui-vendor';
          if (
            id.includes('/node_modules/react-hook-form/') ||
            id.includes('/node_modules/@hookform/') ||
            id.includes('/node_modules/zod/')
          ) {
            return 'form-vendor';
          }
          if (
            id.includes('/node_modules/axios/') ||
            id.includes('/node_modules/clsx/') ||
            id.includes('/node_modules/tailwind-merge/') ||
            id.includes('/node_modules/class-variance-authority/') ||
            id.includes('/node_modules/date-fns/') ||
            id.includes('/node_modules/lucide-react/')
          ) {
            return 'utils-vendor';
          }
          if (id.includes('/node_modules/@tanstack/react-query')) {
            return 'query-vendor';
          }
          return undefined;
        },
      },
    },
    chunkSizeWarningLimit: 1000,
  },
}));