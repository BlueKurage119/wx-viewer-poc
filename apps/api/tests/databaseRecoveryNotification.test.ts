import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeDatabase } from '../src/database/index.js';
import {
  DatabaseRecoveryNotificationEmitter,
  planDatabaseRecoveryNotification,
} from '../src/notifications/index.js';
import { findNotificationOutputHistoryByNotificationId } from '../src/repositories/index.js';
import { InMemoryWarningCurrentRecoveryTracker } from '../src/monitoring/warningCurrentRecoveryTracker.js';

const migrationsDirectory = join(fileURLToPath(import.meta.url), '../../migrations');

test('復旧通知は会場別の固定事実となり、同一IDは二重記録しない', () => {
  const directory = mkdtempSync(join(tmpdir(), 'recovery-notification-'));
  const context = initializeDatabase({
    databasePath: join(directory, 'db.sqlite3'),
    migrationsDirectory,
  });
  try {
    const planned = planDatabaseRecoveryNotification({
      event: 'failed',
      venueId: 'east',
      serverGenerationId: 'generation-1',
      occurredAt: '2026-09-22T00:00:00.000Z',
      notificationIdFactory: () => 'recovery-1',
    });
    assert.deepEqual(planned.notification, {
      notificationId: 'recovery-1',
      origin: 'system',
      category: 'question',
      changeType: 'database_recovery_failed',
      sourceType: 'database_recovery',
      sourceVersion: 'generation-1',
      targets: [{ kind: 'equipment', codeType: 'venue', code: 'east', name: '江東区' }],
      occurredAt: '2026-09-22T00:00:00.000Z',
      detectedAt: '2026-09-22T00:00:00.000Z',
      relatedRefs: [{ type: 'server_generation', ref: 'generation-1' }],
      detectionContext: 'initial',
      isTraining: false,
    });
    assert.equal(planned.output.ackRequired, true);
    const emitter = new DatabaseRecoveryNotificationEmitter(context.connection);
    assert.equal(emitter.emit(planned), true);
    assert.equal(emitter.emit(planned), false);
    assert.equal(
      findNotificationOutputHistoryByNotificationId(context.connection, 'recovery-1')?.category,
      'question',
    );
  } finally {
    context.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('復旧Trackerは会場を分離し、遅延を一度だけ記録して完了・失敗状態を返す', () => {
  const tracker = new InMemoryWarningCurrentRecoveryTracker();
  tracker.start('east', '2026-09-22T00:00:00.000Z');
  assert.equal(tracker.markDelayed('east', '2026-09-22T00:01:00.000Z'), true);
  assert.equal(tracker.markDelayed('east', '2026-09-22T00:02:00.000Z'), false);
  tracker.progress('east', {
    venueId: 'east',
    controlStatus: 'training',
    phase: 'searching',
    parsedReceptionCount: 25,
    reused: false,
  });
  assert.deepEqual(tracker.getStatus('east', '2026-09-22T00:02:00.000Z'), {
    status: 'running',
    startedAt: '2026-09-22T00:00:00.000Z',
    finishedAt: null,
    delayedAt: '2026-09-22T00:01:00.000Z',
    elapsedMs: 120000,
    currentControlStatus: 'training',
    completedControlStatuses: [],
    reusedControlStatuses: [],
    rebuiltControlStatuses: [],
    parsedReceptionCount: 25,
    errorCode: null,
  });
  assert.equal(tracker.getStatus('trc', '2026-09-22T00:02:00.000Z').status, 'idle');
  tracker.fail('east', '2026-09-22T00:02:00.000Z');
  assert.equal(
    tracker.getStatus('east', '2026-09-22T00:03:00.000Z').errorCode,
    'warning_current_recovery_failed',
  );
});

test('復旧候補SQLは部分複合索引を使用し、一時B-treeを作らない', () => {
  const directory = mkdtempSync(join(tmpdir(), 'recovery-index-'));
  const context = initializeDatabase({
    databasePath: join(directory, 'db.sqlite3'),
    migrationsDirectory,
  });
  try {
    context.connection.exec(`
      WITH RECURSIVE fixture(n) AS (
        SELECT 1 UNION ALL SELECT n + 1 FROM fixture WHERE n < 1000
      )
      INSERT INTO telegram_reception (
        document_url, telegram_type, control_status, control_datetime, report_datetime,
        received_at, raw_body
      )
      SELECT 'https://example.invalid/' || n, 'VPWS50', 'normal',
        printf('2026-09-22T00:%02d:00.000Z', n % 60),
        printf('2026-09-22T00:%02d:00.000Z', n % 60),
        '2026-09-22T00:00:00.000Z', '<Report />'
      FROM fixture;
      WITH RECURSIVE excluded(n) AS (
        SELECT 1 UNION ALL SELECT n + 1 FROM excluded WHERE n < 10000
      )
      INSERT INTO telegram_reception (
        document_url, telegram_type, control_status, control_datetime, report_datetime, received_at
      )
      SELECT 'https://example.invalid/excluded/' || n, 'VPWS50', 'normal',
        '2026-09-22T00:00:00.000Z', '2026-09-22T00:00:00.000Z',
        '2026-09-22T00:00:00.000Z'
      FROM excluded;
      ANALYZE;
    `);
    const plan = context.connection
      .prepare(
        `EXPLAIN QUERY PLAN
      SELECT id FROM telegram_reception
      WHERE telegram_type = ? AND control_status = ?
        AND raw_body IS NOT NULL AND report_datetime IS NOT NULL AND control_datetime IS NOT NULL
      ORDER BY report_datetime DESC, control_datetime DESC, id DESC LIMIT ?`,
      )
      .all('VPWS50', 'normal', 100) as { detail: string }[];
    assert.equal(
      plan.some((row) => row.detail.includes('idx_telegram_reception_warning_recovery')),
      true,
      JSON.stringify(plan),
    );
    assert.equal(
      plan.some((row) => row.detail.includes('USE TEMP B-TREE')),
      false,
    );
  } finally {
    context.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
