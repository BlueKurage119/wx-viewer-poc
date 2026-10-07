import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { initializeTestDatabases } from './helpers/databasePair.js';
import { createMonitoringHistoryService } from '../src/monitoring/monitoringHistoryService.js';
import { recordNotificationOutputHistory } from '../src/repositories/notificationOutputHistoryRepository.js';
import { recordTelegramReception } from '../src/repositories/telegramReceptionRepository.js';
import type { TelegramReceptionInput } from '../src/repositories/types.js';
import { createApp } from '../src/app.js';

const now = '2026-10-07T12:00:00.000Z';
const reception = (rawBody: string | null): TelegramReceptionInput => ({
  fetchAttemptId: null,
  feedKind: null,
  feedEntryId: null,
  documentUrl: 'https://example.invalid/fixture.xml',
  telegramType: 'VPWW55',
  title: '別原文',
  controlStatus: 'normal',
  infoType: null,
  eventId: null,
  serial: null,
  controlDateTime: null,
  reportDateTime: null,
  targetDateTime: null,
  receivedAt: now,
  rawBody,
  bodyBytes: rawBody?.length ?? null,
  contentHash: null,
  areas: [],
  adoptions: [],
});

test('AC6 異なる物理DBの世代付き参照はID再利用でも旧通知を別原文へ接続しない', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'wx-reference-'));
  const pair = initializeTestDatabases({
    databasePath: join(directory, 'weather.sqlite3'),
    migrationsDirectory: join(import.meta.dirname, '../migrations'),
  });
  t.after(() => {
    pair.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const service = createMonitoringHistoryService({
    weatherConnection: pair.weather.connection,
    retainedConnection: pair.retained.connection,
    weatherDatabaseGenerationId: pair.weatherDatabaseGenerationId,
    now: () => now,
  });
  const save = (
    id: string,
    generation: string | null,
    refs: string,
    origin: 'weather' | 'system' = 'weather',
  ) =>
    recordNotificationOutputHistory(pair.retained.connection, {
      notificationId: id,
      category: 'warning',
      sourceType: 'warning_current',
      sourceVersion: null,
      targetAreaJson: null,
      occurredAt: now,
      detectedAt: now,
      changeType: 'new',
      ackRequired: false,
      summary: '保存済み旧通知',
      relatedRefsJson: refs,
      origin,
      detectionContext: 'normal',
      isTraining: false,
      messageDefinitionId: null,
      messageDefinitionVersion: null,
      weatherDatabaseGenerationId: generation,
    });
  const ref = (id: number) => JSON.stringify([{ type: 'telegram_reception', ref: String(id) }]);
  const server = createApp({ monitoringHistory: service }).listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const url = `http://127.0.0.1:${address.port}/api/monitoring/notification-outputs`;
  try {
    assert.equal(recordTelegramReception(pair.weather.connection, reception('<new/>')).id, 1);
    const old = save('old', 'previous-weather-generation', ref(1));
    const available = save('available', pair.weatherDatabaseGenerationId, ref(1));
    const missing = save('missing', pair.weatherDatabaseGenerationId, ref(999));
    const unknown = save('unknown', null, ref(1));
    const noRef = save('no-ref', pair.weatherDatabaseGenerationId, '[]');
    const emptyId = recordTelegramReception(pair.weather.connection, reception('')).id;
    const empty = save('empty', pair.weatherDatabaseGenerationId, ref(emptyId));
    const system = save('system', null, ref(1), 'system');
    const list = service.listNotificationOutputs({ limit: 100, offset: 0 });
    assert.deepEqual(
      list.items.map((row) => [row.id, row.summary, row.receptionReference]),
      [
        [system.id, '保存済み旧通知', { status: 'not_applicable' }],
        [empty.id, '保存済み旧通知', { status: 'unavailable', reason: 'raw_body_missing' }],
        [noRef.id, '保存済み旧通知', { status: 'not_applicable' }],
        [unknown.id, '保存済み旧通知', { status: 'unavailable', reason: 'generation_unknown' }],
        [missing.id, '保存済み旧通知', { status: 'unavailable', reason: 'reception_missing' }],
        [available.id, '保存済み旧通知', { status: 'available', receptionId: 1 }],
        [old.id, '保存済み旧通知', { status: 'unavailable', reason: 'weather_generation_changed' }],
      ],
    );
    const oldResponse = await fetch(`${url}/${old.id}/reception`);
    assert.equal(oldResponse.status, 410);
    assert.deepEqual(await oldResponse.json(), {
      status: 'error',
      code: 'notification_reception_unavailable',
      reason: 'weather_generation_changed',
    });
    const good = await fetch(`${url}/${available.id}/reception`);
    assert.equal(good.status, 200);
    assert.equal(
      ((await good.json()) as { reception: { rawBody: string } }).reception.rawBody,
      '<new/>',
    );
    pair.weather.connection
      .prepare('UPDATE telegram_reception SET raw_body = NULL WHERE id = 1')
      .run();
    assert.deepEqual(service.getNotificationReceptionById(available.id), {
      kind: 'unavailable',
      reason: 'raw_body_missing',
    });
    assert.equal((await fetch(`${url}/999/reception`)).status, 404);
    assert.equal((await fetch(`${url}/01/reception`)).status, 400);
    assert.equal((await fetch(`${url}/${old.id}/reception?x=1`)).status, 400);
    pair.weather.connection.close();
    assert.equal((await fetch(`${url}/${available.id}/reception`)).status, 500);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
