import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { initializeDatabase } from '../src/database/index.js';
import { startServer } from '../src/server.js';
import {
  findFetchAttemptById,
  findNotificationOutputHistoryById,
  findOperationHistoryById,
  findTelegramReceptionById,
  recordFetchAttempt,
  recordNotificationOutputHistory,
  recordOperationHistory,
  recordTelegramReception,
  type FetchAttemptInput,
  type NotificationOutputHistoryInput,
  type OperationHistoryInput,
  type TelegramReceptionInput,
} from '../src/repositories/index.js';

const apiRoot = join(fileURLToPath(import.meta.url), '../..');
const migrationsDirectory = join(apiRoot, 'migrations');

function createTempDbPath(): { databasePath: string; cleanup: () => void } {
  const directory = mkdtempSync(join(tmpdir(), 'wx-viewer-poc-retention-test-'));

  return {
    databasePath: join(directory, 'test.sqlite3'),
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
  };
}

test('履歴表に自動削除トリガーがないこと', () => {
  const { databasePath, cleanup } = createTempDbPath();
  try {
    const context = initializeDatabase({ databasePath, migrationsDirectory });

    try {
      const triggers = context.connection
        .prepare(
          `
            SELECT tbl_name, name
            FROM sqlite_master
            WHERE type = 'trigger'
              AND tbl_name IN (?, ?, ?, ?)
            ORDER BY tbl_name, name
          `,
        )
        .all(
          'fetch_attempt',
          'telegram_reception',
          'notification_output_history',
          'operation_history',
        );

      assert.deepEqual(triggers, []);
    } finally {
      context.close();
    }
  } finally {
    cleanup();
  }
});

// テスト用の過去データを準備
const sampleFetchAttemptInput: FetchAttemptInput = {
  sourceKind: 'xml_feed_regular',
  targetRef: null,
  requestUrl: 'https://example.com/retention-001.xml',
  triggerKind: 'scheduled',
  attemptNo: 1,
  startedAt: '2000-01-01T00:00:00Z',
  finishedAt: '2000-01-01T00:00:01Z',
  durationMs: 1000,
  outcome: 'success',
  httpStatus: 200,
  responseBytes: 12345,
  itemCount: null,
  failedItemCount: null,
  contentHash: 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
  errorKind: null,
  errorMessage: null,
};

const sampleTelegramInput: TelegramReceptionInput = {
  fetchAttemptId: null,
  feedKind: 'regular',
  feedEntryId: 'urn:uuid:retention-001',
  documentUrl: 'https://example.com/retention-001.xml',
  telegramType: 'VPWW55',
  title: '気象警報・注意報',
  controlStatus: 'normal',
  infoType: '発表',
  eventId: '20260909000000_130000',
  serial: '1',
  controlDateTime: '2000-01-01T00:00:00Z',
  reportDateTime: '2000-01-01T00:00:00Z',
  targetDateTime: '2000-01-01T00:00:00Z',
  receivedAt: '2000-01-01T00:00:02Z',
  rawBody: '<Report>...</Report>',
  bodyBytes: 20,
  contentHash: 'fedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321',
  adoptions: [
    {
      venueId: 'east',
      adoptionResult: '採用',
      adoptionReason: '最新の発表',
      adoptionDecidedAt: '2000-01-01T00:00:03Z',
    },
  ],
  areas: [
    {
      areaCode: '1310800',
      areaName: '江東区',
      codeType: '気象情報／細分区域等',
      sequence: 1,
    },
  ],
};

const sampleWeatherNotificationInput: NotificationOutputHistoryInput = {
  notificationId: 'retention-notification-001',
  category: 'warning',
  sourceType: 'warning_current',
  sourceVersion: '20260909000000_0_VPWW55_130000',
  targetAreaJson: JSON.stringify({ areaCode: '130010', areaName: '東京都' }),
  occurredAt: '2000-01-01T00:00:00Z',
  detectedAt: '2000-01-01T00:00:02Z',
  changeType: 'new',
  ackRequired: false,
  summary: '大雨警報発表',
  relatedRefsJson: JSON.stringify([{ type: 'telegram', ref: '20260909000000_0_VPWW55_130000' }]),
  origin: 'weather',
  detectionContext: 'normal',
  isTraining: false,
  messageDefinitionId: 'msg-weather-warn-001',
  messageDefinitionVersion: 'v1.0.0',
};

const sampleStartInput: OperationHistoryInput = {
  requestId: 'retention-operation-001',
  operationKind: 'start',
  targetKind: 'all',
  result: 'success',
  requestedAt: '2000-01-01T01:00:00Z',
  completedAt: '2000-01-01T01:00:02Z',
  actorId: null,
  actorDisplayName: null,
  errorCode: null,
  errorMessage: null,
};

test('99年経過とAPI再起動後も過去の履歴が残る', async (t) => {
  const { databasePath, cleanup } = createTempDbPath();
  try {
    const config = { databasePath, migrationsDirectory };

    const expected = (() => {
      const first = initializeDatabase(config);

      try {
        return {
          fetchAttempt: recordFetchAttempt(first.connection, sampleFetchAttemptInput),
          telegram: recordTelegramReception(first.connection, sampleTelegramInput),
          notification: recordNotificationOutputHistory(
            first.connection,
            sampleWeatherNotificationInput,
          ),
          operation: recordOperationHistory(first.connection, sampleStartInput),
        };
      } finally {
        first.close();
      }
    })();

    t.mock.timers.enable({
      apis: ['Date'],
      now: new Date('2099-01-01T00:00:00Z'),
    });

    try {
      const server = await startServer({ config, port: 0, enablePolling: false });

      try {
        const response = await fetch(`http://127.0.0.1:${server.port}/api/health`);

        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { status: 'ok' });
      } finally {
        await server.close();
      }
    } finally {
      t.mock.timers.reset();
    }

    const second = initializeDatabase(config);
    try {
      assert.deepEqual(
        findFetchAttemptById(second.connection, expected.fetchAttempt.id),
        expected.fetchAttempt,
      );
      assert.deepEqual(
        findTelegramReceptionById(second.connection, expected.telegram.id),
        expected.telegram,
      );
      assert.deepEqual(
        findNotificationOutputHistoryById(second.connection, expected.notification.id),
        expected.notification,
      );
      assert.deepEqual(
        findOperationHistoryById(second.connection, expected.operation.id),
        expected.operation,
      );
    } finally {
      second.close();
    }
  } finally {
    cleanup();
  }
});
