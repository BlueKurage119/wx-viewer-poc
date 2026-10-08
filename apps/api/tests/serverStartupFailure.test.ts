import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import express from 'express';
import Database from 'better-sqlite3';
import test from 'node:test';
import { join } from 'node:path';
import { startServer } from '../src/server.js';
import {
  createTemporaryTestDatabaseFixture,
  createTestServerDatabaseOptions,
  createTestServerProcessEnv,
} from './helpers/databasePair.js';

const invalidPorts = [-1, 65536, 1.5, NaN, Infinity, -Infinity];

test('startServerは不正portをDB作成前に拒否しport0は再起動できる', async () => {
  const fixture = createTemporaryTestDatabaseFixture();
  const options = createTestServerDatabaseOptions(fixture.config);
  try {
    for (const port of invalidPorts) {
      await assert.rejects(startServer({ ...options, port, enablePolling: false }), /ポートは/);
      assert.equal(existsSync(options.config.weather.databasePath), false);
      assert.equal(existsSync(options.config.retained.databasePath), false);
    }
    const server = await startServer({ ...options, port: 0, enablePolling: false });
    assert.ok(server.port > 0);
    await server.close();
  } finally {
    fixture.cleanup();
  }
});

for (const method of ['use', 'listen'] as const) {
  test(`startServerは同期${method}失敗で両接続を閉じ同じpairで再起動できる`, async () => {
    const fixture = createTemporaryTestDatabaseFixture();
    const options = createTestServerDatabaseOptions(fixture.config);
    const original = express.application[method];
    const originalClose = Database.prototype.close;
    let closes = 0;
    const failure = new Error(`fixture synchronous ${method} failure`);
    try {
      Database.prototype.close = function () {
        closes += 1;
        return originalClose.call(this);
      };
      Object.defineProperty(express.application, method, {
        value: () => {
          throw failure;
        },
      });
      await assert.rejects(
        startServer({ ...options, port: method === 'listen' ? 65535 : 0, enablePolling: false }),
        (error) => error === failure,
      );
      assert.equal(closes, 2);
      assert.equal(existsSync(options.config.weather.databasePath), true);
      assert.equal(existsSync(options.config.retained.databasePath), true);
      Object.defineProperty(express.application, method, { value: original });
      Database.prototype.close = originalClose;
      const server = await startServer({ ...options, port: 0, enablePolling: false });
      await server.close();
    } finally {
      Object.defineProperty(express.application, method, { value: original });
      Database.prototype.close = originalClose;
      fixture.cleanup();
    }
  });
}

test('mainは不正portをDB作成前に拒否する', () => {
  const fixture = createTemporaryTestDatabaseFixture();
  const options = createTestServerDatabaseOptions(fixture.config);
  try {
    for (const port of ['-1', '65536', '1.5', 'NaN', 'Infinity']) {
      const child = spawnSync(
        process.execPath,
        [
          '--import',
          import.meta.resolve('tsx'),
          new URL('../src/server.ts', import.meta.url).pathname,
        ],
        {
          cwd: join(fixture.config.databasePath, '..'),
          env: {
            ...createTestServerProcessEnv(fixture.config),
            NODE_ENV: 'production',
            DISABLE_POLLING: 'true',
            PORT: port,
          },
          encoding: 'utf8',
          timeout: 15000,
        },
      );
      assert.equal(child.error, undefined);
      assert.equal(child.status, 1, child.stderr);
      assert.match(child.stderr, /ポートは/);
      assert.equal(existsSync(options.config.weather.databasePath), false);
      assert.equal(existsSync(options.config.retained.databasePath), false);
    }
  } finally {
    fixture.cleanup();
  }
});

for (const method of ['use', 'listen']) {
  test(`mainは同期${method}失敗で両接続を閉じ同じpairで再起動できる`, async () => {
    const fixture = createTemporaryTestDatabaseFixture();
    const options = createTestServerDatabaseOptions(fixture.config);
    const marker = join(fixture.config.databasePath, '..', 'closed.txt');
    try {
      const child = spawnSync(
        process.execPath,
        [
          '--import',
          import.meta.resolve('tsx'),
          '--import',
          new URL('./helpers/startupFailurePreload.mjs', import.meta.url).href,
          new URL('../src/server.ts', import.meta.url).pathname,
        ],
        {
          cwd: join(fixture.config.databasePath, '..'),
          env: {
            ...createTestServerProcessEnv(fixture.config),
            NODE_ENV: 'production',
            DISABLE_POLLING: 'true',
            PORT: method === 'listen' ? '65535' : '0',
            WX_TEST_STARTUP_FAILURE: method,
            WX_TEST_CLOSE_MARKER: marker,
          },
          encoding: 'utf8',
          timeout: 15000,
        },
      );
      assert.equal(child.error, undefined);
      assert.equal(child.status, 1, child.stderr);
      assert.match(child.stderr, new RegExp(`fixture synchronous ${method} failure`));
      assert.equal(readFileSync(marker, 'utf8'), 'close\nclose\n');
      const server = await startServer({ ...options, port: 0, enablePolling: false });
      await server.close();
    } finally {
      fixture.cleanup();
    }
  });
}
