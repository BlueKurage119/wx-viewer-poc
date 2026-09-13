import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { UtcIso8601String } from '@wx-viewer-poc/shared';
import { initializeDatabase } from '../src/database/index.js';
import { listNotificationOutputHistory } from '../src/repositories/index.js';
import { FetchHealthStateStore } from '../src/monitoring/fetchHealthStateStore.js';
import {
  aggregateFetchHealth,
  type FetchSourceHealthResult,
} from '../src/monitoring/fetchHealthEvaluator.js';
import {
  MONITORED_FETCH_SOURCES,
  type MonitoredFetchSourceId,
} from '../src/monitoring/fetchHealthSources.js';
import { emitFetchHealthNotification } from '../src/notifications/fetchHealthNotificationEmitter.js';

const apiRoot = join(fileURLToPath(import.meta.url), '../..');
const migrationsDirectory = join(apiRoot, 'migrations');

function createTempDb(): { databasePath: string; cleanup: () => void } {
  const directory = mkdtempSync(join(tmpdir(), 'wx-viewer-poc-emitter-test-'));
  const databasePath = join(directory, 'test.sqlite3');
  return {
    databasePath,
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
  };
}

function createResult(
  sourceId: MonitoredFetchSourceId,
  status: FetchSourceHealthResult['status'],
): FetchSourceHealthResult {
  return {
    sourceId,
    status,
    reasons:
      status === 'normal' || status === 'suspended'
        ? []
        : [
            {
              kind: 'consecutive_failures',
              status,
              sourceKind: sourceId,
              text: '連続失敗',
            },
          ],
    lastAttemptAt: '2026-09-09T00:01:00.000Z' as UtcIso8601String,
    lastSuccessAt: '2026-09-09T00:00:00.000Z' as UtcIso8601String,
    maxConsecutiveFailures: status === 'abnormal' ? 5 : status === 'delayed' ? 2 : 0,
    intervalSeconds: 60,
  };
}

test('emitFetchHealthNotification: 通知の永続化と重複抑止', () => {
  const { databasePath, cleanup } = createTempDb();
  try {
    const database = initializeDatabase({ databasePath, migrationsDirectory });
    const store = new FetchHealthStateStore();
    const now = () => '2026-09-09T00:01:00.000Z' as UtcIso8601String;

    // 1 回目評価: 初期状態で normal
    const aggregate1 = aggregateFetchHealth(
      MONITORED_FETCH_SOURCES.map((def) => createResult(def.id, 'normal')),
      now(),
    );
    const result1 = emitFetchHealthNotification(database.connection, aggregate1, store, { now });
    assert.equal(result1.recorded.length, 0);

    // 2 回目評価: xml_regular が delayed に遷移
    const aggregate2 = aggregateFetchHealth(
      MONITORED_FETCH_SOURCES.map((def) =>
        createResult(def.id, def.id === 'xml_regular' ? 'delayed' : 'normal'),
      ),
      now(),
    );
    const result2 = emitFetchHealthNotification(database.connection, aggregate2, store, { now });
    assert.equal(result2.recorded.length, 1);
    assert.equal(result2.recorded[0].category, 'warning');
    assert.equal(result2.recorded[0].changeType, 'fetch_delayed');

    const history = listNotificationOutputHistory(database.connection, { origin: 'system' });
    assert.equal(history.length, 1);
    assert.equal(history[0].category, 'warning');
    assert.equal(history[0].changeType, 'fetch_delayed');

    // 3 回目評価: 同じ状態で再度 emit -> 重複通知なし (recorded: 0)
    const result3 = emitFetchHealthNotification(database.connection, aggregate2, store, { now });
    assert.equal(result3.recorded.length, 0);

    const historyAfter = listNotificationOutputHistory(database.connection, { origin: 'system' });
    assert.equal(historyAfter.length, 1);

    database.close();
  } finally {
    cleanup();
  }
});
