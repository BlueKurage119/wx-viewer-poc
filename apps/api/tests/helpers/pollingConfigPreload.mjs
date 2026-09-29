import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { syncBuiltinESMExports } from 'node:module';

const defaultConfigPath = fileURLToPath(
  new URL('../../../../config/polling.yaml', import.meta.url),
);
const fixturePath = fileURLToPath(new URL('../fixtures/polling/schedule.yaml', import.meta.url));
const defaultConfigUrl = pathToFileURL(defaultConfigPath).href;
const localConfigUrl = new URL('../../../../config/polling.local.yaml', import.meta.url).href;
const originalReadFileSync = fs.readFileSync;

if (process.env.WX_TEST_UPSTREAM_MARKER) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (...args) => {
    fs.writeFileSync(process.env.WX_TEST_UPSTREAM_MARKER, 'fetch');
    return originalFetch(...args);
  };
}

fs.readFileSync = function readFileSyncForPollingFixture(path, ...options) {
  const requested = path instanceof URL ? path.href : String(path);
  if (requested === localConfigUrl) {
    if (process.env.WX_TEST_LOCAL_POLLING_YAML !== undefined) {
      return process.env.WX_TEST_LOCAL_POLLING_YAML;
    }
    const error = new Error('テスト用ローカルファイル不在');
    error.code = 'ENOENT';
    throw error;
  }
  if (requested === defaultConfigPath || requested === defaultConfigUrl) {
    return originalReadFileSync.call(fs, fixturePath, ...options);
  }
  return originalReadFileSync.call(fs, path, ...options);
};
syncBuiltinESMExports();
