import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5280,
    strictPort: true,
    // The API and realtime server (apps/server) run on 5281.
    proxy: {
      '/api': 'http://localhost:5281',
      '/collab': { target: 'ws://localhost:5281', ws: true },
    },
  },
});
