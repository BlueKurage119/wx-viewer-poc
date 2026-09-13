import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { UtcIso8601String } from '@wx-viewer-poc/shared';
import { initializeDatabase } from '../src/database/index.js';
import {
  recordFetchAttempt,
  summarizeFetchStreamHealth,
  type FetchAttemptInput,
} from '../src/repositories/index.js';

const apiRoot = join(fileURLToPath(import.meta.url), '../..');
const migrationsDirectory = join(apiRoot, 'migrations');

function createTempDb(): { databasePath: string; cleanup: () => void } {
  const directory = mkdtempSync(join(tmpdir(), 'wx-viewer-poc-fetch-attempt-test-'));
  const databasePath = join(directory, 'test.sqlite3');
  return {
    databasePath,
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
  };
}

function createSampleAttempt(overrides: Partial<FetchAttemptInput> = {}): FetchAttemptInput {
  return {
    sourceKind: 'xml_feed_regular',
    targetRef: null,
    requestUrl: 'https://example.com/feed.xml',
    triggerKind: 'scheduled',
    attemptNo: 1,
    startedAt: '2026-09-09T00:00:00.000Z' as UtcIso8601String,
    finishedAt: '2026-09-09T00:00:01.000Z' as UtcIso8601String,
    durationMs: 1000,
    outcome: 'success',
    httpStatus: 200,
    responseBytes: 100,
    itemCount: null,
    failedItemCount: null,
    contentHash: 'hash1',
    errorKind: null,
    errorMessage: null,
    ...overrides,
  };
}

test('summarizeFetchStreamHealth: 行が 1 件もない場合は初期値を返す', () => {
  const { databasePath, cleanup } = createTempDb();
  try {
    const database = initializeDatabase({ databasePath, migrationsDirectory });
    const summary = summarizeFetchStreamHealth(database.connection, 'xml_feed_regular', 50);
    assert.deepEqual(summary, {
      sourceKind: 'xml_feed_regular',
      lastAttemptAt: null,
      lastSuccessAt: null,
      consecutiveFailures: 0,
      consecutiveFailuresCapped: false,
    });
    database.close();
  } finally {
    cleanup();
  }
});

test('summarizeFetchStreamHealth: 成功のみの場合', () => {
  const { databasePath, cleanup } = createTempDb();
  try {
    const database = initializeDatabase({ databasePath, migrationsDirectory });
    recordFetchAttempt(
      database.connection,
      createSampleAttempt({
        startedAt: '2026-09-09T00:00:00.000Z' as UtcIso8601String,
        outcome: 'success',
      }),
    );
    recordFetchAttempt(
      database.connection,
      createSampleAttempt({
        startedAt: '2026-09-09T00:01:00.000Z' as UtcIso8601String,
        outcome: 'success',
      }),
    );

    const summary = summarizeFetchStreamHealth(database.connection, 'xml_feed_regular', 50);
    assert.deepEqual(summary, {
      sourceKind: 'xml_feed_regular',
      lastAttemptAt: '2026-09-09T00:01:00.000Z',
      lastSuccessAt: '2026-09-09T00:01:00.000Z',
      consecutiveFailures: 0,
      consecutiveFailuresCapped: false,
    });
    database.close();
  } finally {
    cleanup();
  }
});

test('summarizeFetchStreamHealth: 失敗のみの場合', () => {
  const { databasePath, cleanup } = createTempDb();
  try {
    const database = initializeDatabase({ databasePath, migrationsDirectory });
    recordFetchAttempt(
      database.connection,
      createSampleAttempt({
        startedAt: '2026-09-09T00:00:00.000Z' as UtcIso8601String,
        outcome: 'failure',
      }),
    );
    recordFetchAttempt(
      database.connection,
      createSampleAttempt({
        startedAt: '2026-09-09T00:01:00.000Z' as UtcIso8601String,
        outcome: 'failure',
      }),
    );

    const summary = summarizeFetchStreamHealth(database.connection, 'xml_feed_regular', 50);
    assert.deepEqual(summary, {
      sourceKind: 'xml_feed_regular',
      lastAttemptAt: '2026-09-09T00:01:00.000Z',
      lastSuccessAt: null,
      consecutiveFailures: 2,
      consecutiveFailuresCapped: false,
    });
    database.close();
  } finally {
    cleanup();
  }
});

test('summarizeFetchStreamHealth: 成功と失敗が混在する場合', () => {
  const { databasePath, cleanup } = createTempDb();
  try {
    const database = initializeDatabase({ databasePath, migrationsDirectory });
    // 時系列:
    // T0: failure
    // T1: success
    // T2: failure
    // T3: failure
    recordFetchAttempt(
      database.connection,
      createSampleAttempt({
        startedAt: '2026-09-09T00:00:00.000Z' as UtcIso8601String,
        outcome: 'failure',
      }),
    );
    recordFetchAttempt(
      database.connection,
      createSampleAttempt({
        startedAt: '2026-09-09T00:01:00.000Z' as UtcIso8601String,
        outcome: 'success',
      }),
    );
    recordFetchAttempt(
      database.connection,
      createSampleAttempt({
        startedAt: '2026-09-09T00:02:00.000Z' as UtcIso8601String,
        outcome: 'failure',
      }),
    );
    recordFetchAttempt(
      database.connection,
      createSampleAttempt({
        startedAt: '2026-09-09T00:03:00.000Z' as UtcIso8601String,
        outcome: 'failure',
      }),
    );

    const summary = summarizeFetchStreamHealth(database.connection, 'xml_feed_regular', 50);
    assert.deepEqual(summary, {
      sourceKind: 'xml_feed_regular',
      lastAttemptAt: '2026-09-09T00:03:00.000Z',
      lastSuccessAt: '2026-09-09T00:01:00.000Z',
      consecutiveFailures: 2,
      consecutiveFailuresCapped: false,
    });
    database.close();
  } finally {
    cleanup();
  }
});

test('summarizeFetchStreamHealth: 窓超過 (全件失敗で capped=true、窓外の過去成功を拾う)', () => {
  const { databasePath, cleanup } = createTempDb();
  try {
    const database = initializeDatabase({ databasePath, migrationsDirectory });
    // 窓外の成功
    recordFetchAttempt(
      database.connection,
      createSampleAttempt({
        startedAt: '2026-09-09T00:00:00.000Z' as UtcIso8601String,
        outcome: 'success',
      }),
    );
    // 窓内の失敗 (3件)
    recordFetchAttempt(
      database.connection,
      createSampleAttempt({
        startedAt: '2026-09-09T00:01:00.000Z' as UtcIso8601String,
        outcome: 'failure',
      }),
    );
    recordFetchAttempt(
      database.connection,
      createSampleAttempt({
        startedAt: '2026-09-09T00:02:00.000Z' as UtcIso8601String,
        outcome: 'failure',
      }),
    );
    recordFetchAttempt(
      database.connection,
      createSampleAttempt({
        startedAt: '2026-09-09T00:03:00.000Z' as UtcIso8601String,
        outcome: 'failure',
      }),
    );

    // maxScanAttempts = 3
    const summary = summarizeFetchStreamHealth(database.connection, 'xml_feed_regular', 3);
    assert.deepEqual(summary, {
      sourceKind: 'xml_feed_regular',
      lastAttemptAt: '2026-09-09T00:03:00.000Z',
      lastSuccessAt: '2026-09-09T00:00:00.000Z',
      consecutiveFailures: 3,
      consecutiveFailuresCapped: true,
    });
    database.close();
  } finally {
    cleanup();
  }
});

test('summarizeFetchStreamHealth: ミリ秒混在での実時刻順ソート', () => {
  const { databasePath, cleanup } = createTempDb();
  try {
    const database = initializeDatabase({ databasePath, migrationsDirectory });
    // SQL辞書順では '...:00Z' > '...:00.500Z' となる ('.' < 'Z')
    // しかし実時刻では '...:00.500Z' の方が後 (より新しい)
    recordFetchAttempt(
      database.connection,
      createSampleAttempt({
        startedAt: '2026-09-09T00:00:00Z' as UtcIso8601String,
        outcome: 'success',
      }),
    );
    recordFetchAttempt(
      database.connection,
      createSampleAttempt({
        startedAt: '2026-09-09T00:00:00.500Z' as UtcIso8601String,
        outcome: 'failure',
      }),
    );

    const summary = summarizeFetchStreamHealth(database.connection, 'xml_feed_regular', 50);
    assert.deepEqual(summary, {
      sourceKind: 'xml_feed_regular',
      lastAttemptAt: '2026-09-09T00:00:00.500Z',
      lastSuccessAt: '2026-09-09T00:00:00Z',
      consecutiveFailures: 1,
      consecutiveFailuresCapped: false,
    });
    database.close();
  } finally {
    cleanup();
  }
});

test('summarizeFetchStreamHealth: 不正な引数で例外', () => {
  const { databasePath, cleanup } = createTempDb();
  try {
    const database = initializeDatabase({ databasePath, migrationsDirectory });
    assert.throws(() => summarizeFetchStreamHealth(database.connection, '', 50));
    assert.throws(() => summarizeFetchStreamHealth(database.connection, 'xml_feed_regular', 0));
    assert.throws(() => summarizeFetchStreamHealth(database.connection, 'xml_feed_regular', -1));
    assert.throws(() => summarizeFetchStreamHealth(database.connection, 'xml_feed_regular', 1.5));
    database.close();
  } finally {
    cleanup();
  }
});
