import { spawn } from 'node:child_process';
import { watch } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const apiOnly = process.argv.includes('--api-only');
const args = process.argv.slice(2).filter((arg) => arg !== '--api-only');
const colorsEnabled =
  process.env.FORCE_COLOR !== undefined
    ? process.env.FORCE_COLOR !== '0'
    : Boolean(process.stdout.isTTY) && process.env.NO_COLOR === undefined;
// pipe越しの子にも端末の色設定を渡す。明示指定と非端末への出力は維持する。
const childEnv =
  colorsEnabled && process.env.FORCE_COLOR === undefined
    ? { ...process.env, FORCE_COLOR: '1' }
    : process.env;
const prefix = (name) =>
  colorsEnabled ? `\u001b[${name === 'web' ? 34 : 32}m[${name}]\u001b[39m` : `[${name}]`;
const children = new Set();
const watchers = [];
let api;
let stopping = false;
let restart;
let debounce;

function launch(name, cwd, commandArgs) {
  // 端末のprocess groupから分離し、終了signalはこのrunnerだけが転送する。
  const child = spawn(process.execPath, commandArgs, {
    cwd,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: childEnv,
  });
  const state = { child, expected: false, stopping: undefined, done: undefined };
  state.done = new Promise((resolveExit) => {
    child.once('error', (error) => {
      console.error(`${prefix(name)} 起動失敗:`, error);
      resolveExit(1);
    });
    child.once('close', (code, signal) => {
      children.delete(state);
      resolveExit(
        state.expected && name === 'web' && code === 143
          ? 0
          : (code ?? (state.expected && signal === 'SIGTERM' ? 0 : 1)),
      );
      if (!state.expected && !stopping) {
        console.error(`${prefix(name)} 予期しない終了 (${signal ?? code})`);
        void shutdown(code || 1);
      }
    });
  });
  for (const output of [child.stdout, child.stderr]) {
    let tail = '';
    output.setEncoding('utf8').on('data', (chunk) => {
      const lines = (tail + chunk).split('\n');
      tail = lines.pop();
      for (const line of lines) console.log(`${prefix(name)} ${line}`);
    });
    output.on('end', () => {
      if (tail) console.log(`${prefix(name)} ${tail}`);
    });
  }
  children.add(state);
  return state;
}
function stop(state) {
  if (state.stopping) return state.stopping;
  state.expected = true;
  state.child.kill('SIGTERM');
  const warning = setTimeout(() => {
    console.error(
      '[dev] 停止に30秒以上かかっています。強制終了せず終了を待ちます。新APIは起動しません。',
    );
    process.exitCode = 1;
  }, 30000);
  warning.unref();
  state.stopping = state.done
    .then((code) => {
      if (code) {
        console.error(`[dev] 子プロセスの停止が失敗しました (${code})。再起動しません。`);
        process.exitCode = code;
      }
      return code;
    })
    .finally(() => clearTimeout(warning));
  return state.stopping;
}
async function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code || process.exitCode || 0;
  clearTimeout(debounce);
  for (const watcher of watchers) watcher.close();
  await Promise.all([...children].map(stop));
}
function startApi() {
  return launch('api', resolve(root, 'apps/api'), [
    '--import',
    import.meta.resolve('tsx'),
    'src/server.ts',
    ...(apiOnly ? args : []),
  ]);
}
function scheduleRestart() {
  if (stopping) return;
  clearTimeout(debounce);
  debounce = setTimeout(() => {
    if (restart || stopping) return;
    restart = (async () => {
      console.log('[api] 変更を検知しました。終了完了後に再起動します。');
      await stop(api);
      // 旧プロセスの停止中に届いた変更も次の起動へ含める。
      if (!stopping && !process.exitCode) api = startApi();
      else if (!stopping) await shutdown(process.exitCode || 1);
    })()
      .catch((error) => {
        console.error('[dev] 再起動に失敗しました:', error);
        return shutdown(1);
      })
      .finally(() => {
        restart = undefined;
      });
  }, 100);
}
process.on('SIGINT', () => {
  void shutdown();
});
process.on('SIGTERM', () => {
  void shutdown();
});
process.on('SIGHUP', () => {
  void shutdown();
});
try {
  for (const path of ['apps/api/src', 'packages/shared/src', 'packages/shared/dist', 'config']) {
    watchers.push(watch(resolve(root, path), { recursive: true }, scheduleRestart));
  }
  api = startApi();
  if (!apiOnly)
    launch('web', resolve(root, 'apps/web'), [
      resolve(root, 'node_modules/vite/bin/vite.js'),
      ...args,
    ]);
} catch (error) {
  console.error('[dev] 起動設定に失敗しました:', error);
  await shutdown(1);
}
