import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { fileURLToPath } from 'node:url';

// 実設定を既定パスで読む本番スクリプトを、テスト用fixtureで動かすためのpreload。
// 既定の会場・端末・pollingをfixtureへ差し替え、ローカル設定は不在として扱う。
const repoConfig = (name) => fileURLToPath(new URL(`../../../../config/${name}`, import.meta.url));
const fixture = (name) => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));
const redirects = new Map([
  [repoConfig('venues.yaml'), fixture('config/venues.yaml')],
  [repoConfig('terminals.yaml'), fixture('config/terminals.yaml')],
  [repoConfig('polling.yaml'), fixture('polling/schedule.yaml')],
]);
const absent = new Set(
  ['venues.local.yaml', 'terminals.local.yaml', 'polling.local.yaml'].map(repoConfig),
);
const originalReadFileSync = fs.readFileSync;

fs.readFileSync = function readFileSyncForConfigFixture(path, ...options) {
  const requested = path instanceof URL ? fileURLToPath(path) : String(path);
  if (absent.has(requested)) {
    const error = new Error('テスト用ローカルファイル不在');
    error.code = 'ENOENT';
    throw error;
  }
  const redirected = redirects.get(requested);
  return originalReadFileSync.call(fs, redirected ?? path, ...options);
};
syncBuiltinESMExports();
