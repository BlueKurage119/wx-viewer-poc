import { defineConfig, type Plugin, type Connect } from 'vite';
import { isUnknownTerminalDocument } from './src/shell/terminalRouting';
import react from '@vitejs/plugin-react';

const API_DEV_PORT = 3001;
const WEB_DEV_PORT = 5174;

const terminalGuard: Connect.NextHandleFunction = (req, res, next) => {
  if (
    (req.method === 'GET' || req.method === 'HEAD') &&
    isUnknownTerminalDocument(req.url ?? '/', req.headers.accept)
  ) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(
      '<!doctype html><html lang="ja" style="color-scheme: only dark;"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>端末が見つかりません</title><body style="color-scheme: only dark;font-family:system-ui;padding:40px"><h1>許可されていない端末です</h1><p>指定された端末URLでアクセスしてください。</p></body></html>',
    );
    return;
  }
  next();
};
const terminalRoutes = (): Plugin => ({
  name: 'terminal-routes',
  configureServer(server) {
    server.middlewares.use(terminalGuard);
  },
  configurePreviewServer(server) {
    server.middlewares.use(terminalGuard);
  },
});

export default defineConfig({
  plugins: [react(), terminalRoutes()],
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
