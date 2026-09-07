import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API_DEV_PORT = 3001;
const WEB_DEV_PORT = 5174;

export default defineConfig({
  plugins: [react()],
  server: {
    port: WEB_DEV_PORT,
    strictPort: true,
    proxy: {
      '/api': {
        target: `http://localhost:${API_DEV_PORT}`,
        changeOrigin: true,
      },
    },
  },
});
