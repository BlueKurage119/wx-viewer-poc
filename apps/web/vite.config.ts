import { defineConfig, type Plugin, type Connect } from 'vite';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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

const labsButtonElementPath = fileURLToPath(
  new URL(
    '../../node_modules/@material/web/labs/gb/components/button/button-element.js',
    import.meta.url,
  ),
);
const labsButtonModulePath = path.join(path.dirname(labsButtonElementPath), 'md-gb-button.js');
const virtualLabsButtonElementId = '\0material-web-labs-gb-button-element';

/**
 * Labs配布物のbutton-elementを仮想モジュール化する。
 * CSS import assertionを、同梱のLit用CSSResultへ絶対パスで差し替える。
 */
const materialWebLabsCssResult = (): Plugin => ({
  name: 'material-web-labs-css-result',
  enforce: 'pre',
  resolveId(source, importer) {
    if (source === './button-element.js' && importer?.split('?', 1)[0] === labsButtonModulePath) {
      return virtualLabsButtonElementId;
    }
    return null;
  },
  load(id) {
    if (id === virtualLabsButtonElementId) {
      return {
        code: readFileSync(labsButtonElementPath, 'utf8').replace(
          /from '([^']+)'(?: with \{ type: 'css' \})?/g,
          (_match, source: string) => {
            if (!source.startsWith('.')) {
              return `from '${source}'`;
            }
            const target = path.resolve(
              path.dirname(labsButtonElementPath),
              source.endsWith('.css') ? source.replace(/\.css$/, '.cssresult.js') : source,
            );
            return `from ${JSON.stringify(target)}`;
          },
        ),
        map: null,
      };
    }
    return null;
  },
});

export default defineConfig({
  plugins: [materialWebLabsCssResult(), react(), terminalRoutes()],
  optimizeDeps: {
    // CSS import assertionを含むLabs配布物は、上記transformを通してから読み込む。
    exclude: [
      '@material/web/labs/gb/components/button/md-gb-button',
      '@material/web/labs/gb/components/button/md-gb-button.js',
    ],
  },
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
