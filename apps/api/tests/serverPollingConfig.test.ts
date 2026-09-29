import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { startServer } from '../src/server.js';
import { DEFAULT_CONFIG_URL, LOCAL_CONFIG_URL } from '../src/config/pollingScheduleLoader.js';
import { createTestPollingSchedule } from './helpers/pollingSchedule.js';

const originalRead = fs.readFileSync;
const shared = originalRead(DEFAULT_CONFIG_URL, 'utf-8');

function mockLocal(content: string | null): () => void {
  fs.readFileSync = ((file: Parameters<typeof fs.readFileSync>[0], ...args: unknown[]) => {
    const href = file instanceof URL ? file.href : String(file);
    if (href === DEFAULT_CONFIG_URL.href) return shared;
    if (href === LOCAL_CONFIG_URL.href) {
      if (content === null) {
        const error = new Error('ファイルなし') as NodeJS.ErrnoException;
        error.code = 'ENOENT';
        throw error;
      }
      return content;
    }
    return originalRead(file, ...(args as [BufferEncoding]));
  }) as typeof fs.readFileSync;
  syncBuiltinESMExports();
  return () => {
    fs.readFileSync = originalRead;
    syncBuiltinESMExports();
  };
}

async function captureStartup(options: Parameters<typeof startServer>[0]): Promise<string[]> {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'polling-startup-'));
  const messages: string[] = [];
  const originalInfo = console.info;
  console.info = (...args: unknown[]) => messages.push(args.join(' '));
  try {
    const server = await startServer({
      ...options,
      config: {
        databasePath: path.join(directory, 'test.sqlite3'),
        migrationsDirectory: path.join(import.meta.dirname, '../migrations'),
      },
      port: 0,
      enablePolling: false,
    });
    await server.close();
    return messages;
  } finally {
    console.info = originalInfo;
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test('起動ごとに設定元とローカル状態を一度表示する', async () => {
  const oldEnv = process.env.NODE_ENV;
  try {
    delete process.env.NODE_ENV;
    let restore = mockLocal(null);
    try {
      assert.deepEqual(await captureStartup({}), [
        'ポーリング設定: 読み込み元=config/polling.yaml; ローカル上書き=なし（ファイルなし）',
      ]);
    } finally {
      restore();
    }

    restore = mockLocal('tileDeliveryProfile: jma-direct');
    try {
      assert.deepEqual(await captureStartup({}), [
        'ポーリング設定: 読み込み元=config/polling.yaml, config/polling.local.yaml; ローカル上書き=あり',
      ]);
      process.env.NODE_ENV = 'production';
      assert.deepEqual(await captureStartup({}), [
        'ポーリング設定: 読み込み元=config/polling.yaml; ローカル上書き=無効（production）',
      ]);
    } finally {
      restore();
    }

    const fixture = pathToFileURL(path.join(import.meta.dirname, 'fixtures/polling/schedule.yaml'));
    assert.deepEqual(await captureStartup({ configUrl: fixture }), [
      `ポーリング設定: 読み込み元=${fixture.href}; ローカル上書き=対象外（明示URL）`,
    ]);
    assert.deepEqual(await captureStartup({ pollingSchedule: createTestPollingSchedule() }), [
      'ポーリング設定: 読み込み元=設定オブジェクト; ローカル上書き=対象外（設定注入）',
    ]);
  } finally {
    if (oldEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = oldEnv;
  }
});

test('不正なローカル設定はDB初期化と待受より前に拒否する', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'polling-startup-failure-'));
  const databasePath = path.join(directory, 'test.sqlite3');
  const restore = mockLocal('unknown: 1');
  const originalInfo = console.info;
  const messages: string[] = [];
  const oldEnv = process.env.NODE_ENV;
  delete process.env.NODE_ENV;
  console.info = (...args: unknown[]) => messages.push(args.join(' '));
  try {
    await assert.rejects(
      startServer({
        config: {
          databasePath,
          migrationsDirectory: path.join(import.meta.dirname, '../migrations'),
        },
        port: 0,
        enablePolling: false,
      }),
      /未知のルート設定キーです: unknown/,
    );
    assert.deepEqual(messages, []);
    assert.equal(fs.existsSync(databasePath), false);
  } finally {
    console.info = originalInfo;
    restore();
    if (oldEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = oldEnv;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('実プロセスの不正設定はDB生成と待受より前に失敗する', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'polling-child-failure-'));
  const databasePath = path.join(directory, 'test.sqlite3');
  try {
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', '--import', './tests/helpers/pollingConfigPreload.mjs', 'src/server.ts'],
      {
        cwd: path.join(import.meta.dirname, '..'),
        env: {
          ...process.env,
          NODE_ENV: 'development',
          DISABLE_POLLING: 'true',
          WX_VIEWER_DB_PATH: databasePath,
          WX_TEST_LOCAL_POLLING_YAML: 'unknown: 1',
          WX_TEST_UPSTREAM_MARKER: path.join(directory, 'upstream-called'),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let output = '';
    child.stdout.setEncoding('utf-8').on('data', (chunk: string) => (output += chunk));
    child.stderr.setEncoding('utf-8').on('data', (chunk: string) => (output += chunk));
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', resolve);
    });
    assert.equal(exitCode, 1);
    assert.match(output, /polling.local.yaml.*未知のルート設定キーです: unknown/s);
    assert.doesNotMatch(output, /ポーリング設定:|listening on/);
    assert.equal(fs.existsSync(databasePath), false);
    assert.equal(fs.existsSync(path.join(directory, 'upstream-called')), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('実プロセスも同じ形式の成功ログを一度表示する', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'polling-child-success-'));
  const child = spawn(
    process.execPath,
    ['--import', 'tsx', '--import', './tests/helpers/pollingConfigPreload.mjs', 'src/server.ts'],
    {
      cwd: path.join(import.meta.dirname, '..'),
      env: {
        ...process.env,
        NODE_ENV: 'development',
        DISABLE_POLLING: 'true',
        WX_VIEWER_DB_PATH: path.join(directory, 'test.sqlite3'),
        WX_TEST_LOCAL_POLLING_ABSENT: 'true',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let output = '';
  child.stdout.setEncoding('utf-8').on('data', (chunk: string) => (output += chunk));
  child.stderr.setEncoding('utf-8').on('data', (chunk: string) => (output += chunk));
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`起動ログ待機タイムアウト: ${output}`)),
        10000,
      );
      const inspect = () => {
        if (output.includes('ポーリング設定:')) {
          clearTimeout(timer);
          resolve();
        }
      };
      child.stdout.on('data', inspect);
      child.stderr.on('data', inspect);
      child.once('error', reject);
      child.once('close', (code) => reject(new Error(`起動前に終了しました (${code}): ${output}`)));
    });
    assert.equal(
      output.match(
        /ポーリング設定: 読み込み元=config\/polling.yaml; ローカル上書き=なし（ファイルなし）/g,
      )?.length,
      1,
    );
  } finally {
    child.kill('SIGTERM');
    await new Promise((resolve) => child.once('close', resolve));
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
