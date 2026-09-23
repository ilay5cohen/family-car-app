import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const proxy = {
  '/api': {
    target: 'http://localhost:5000',
    changeOrigin: true
  }
};

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  server: { port: 5173, proxy },
  // `vite preview` does NOT inherit server.proxy - it needs its own, or the
  // production build served locally gets a 404 on every API call.
  preview: { port: 4173, proxy },
  build: {
    // Slightly smaller, and the service worker caches the hashed assets anyway.
    sourcemap: false
  }
});
