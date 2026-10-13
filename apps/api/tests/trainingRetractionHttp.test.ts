import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import test from 'node:test';
import {
  createTerminalRegistry,
  parseTrainingInjectionsResponse,
  parseTrainingRetractResponse,
  TRAINING_RETRACT_MAX_TRAINING_IDS,
} from '@wx-viewer-poc/shared';
import { createApp } from '../src/app.js';
import { createTrainingInjectionService } from '../src/services/trainingInjectionService.js';
import { createTrainingRetractionService } from '../src/services/trainingRetractionService.js';
import type {
  TrainingInjectionPort,
  TrainingRetractionPort,
} from '../src/training/trainingInjectionContracts.js';
import { listCompletedTrainingInjections } from '../src/repositories/trainingInjectionRepository.js';
import { retractTrainingTelegrams } from '../src/training/trainingRetractor.js';
import { fixedClock, inject, setupDb, count } from './helpers/trainingRetraction.js';
import { testVenueRegistry } from './helpers/venueConfigPreload.js';

const EAST = testVenueRegistry.resolveVenueId('east')!;
const TRC = testVenueRegistry.resolveVenueId('trc')!;
const registry = createTerminalRegistry(
  [
    { id: 'kkeagh01', name: '東K1', mode: 'K', venueId: EAST },
    { id: 'kkeagh02', name: '東K2', mode: 'K', venueId: EAST },
    { id: 'hkeagh01', name: '東H', mode: 'H', venueId: EAST },
    { id: 'ktrcph01', name: 'TRC K', mode: 'K', venueId: TRC },
  ],
  'test-generation',
);
const NOW = '2026-10-12T10:00:00.000Z';
const GEN_TIME = '2026-10-12T09:00:00.000Z';
const RETRACTION_ID = 'a0a0a0a0-a0a0-40a0-80a0-000000000000';

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any
type Call = (
  method: string,
  path: string,
  body?: unknown,
) => Promise<{ status: number; cache: string | null; json: Json }>;

async function withServer<T>(
  retractionPort: TrainingRetractionPort | undefined,
  injectionPort: TrainingInjectionPort | undefined,
  run: (call: Call) => Promise<T>,
): Promise<T> {
  let sequence = 0;
  const trainingRetraction = createTrainingRetractionService({
    terminalRegistry: registry,
    port: retractionPort,
    now: () => NOW,
    idFactory: () => `a0a0a0a0-a0a0-40a0-80a0-${String(sequence++).padStart(12, '0')}`,
  });
  const trainingInjection = createTrainingInjectionService({
    terminalRegistry: registry,
    port: injectionPort,
    now: () => NOW,
  });
  const server = await new Promise<Server>((resolve, reject) => {
    const listening = createApp({ trainingRetraction, trainingInjection }).listen(
      0,
      '127.0.0.1',
      () => resolve(listening),
    );
    listening.once('error', reject);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('missing TCP address');
  try {
    return await run(async (method, path, body) => {
      const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
        method,
        headers: body === undefined ? {} : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await response.text();
      let json: unknown = null;
      try {
        json = JSON.parse(text);
      } catch {
        // 非JSON
      }
      return { status: response.status, cache: response.headers.get('cache-control'), json };
    });
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

test('POST /api/training/retract: 実Worker処理に接続した正常系・404・409・形式不正・権限', async () => {
  const db = setupDb();
  try {
    const clock = fixedClock();
    const a = await inject(db.weather.connection, ['warning-03', 'bulletin-tornado'], {
      now: GEN_TIME,
      clock,
    });
    const other = await inject(db.weather.connection, ['warning-14'], {
      now: '2026-10-12T09:20:00.000Z',
      clock,
      terminalId: 'ktrcph01',
    });
    const failed = await inject(db.weather.connection, ['bulletin-linear-occurrence'], {
      now: '2026-10-12T09:30:00.000Z',
      clock,
    });
    db.weather.connection
      .prepare("UPDATE training_injection SET status = 'failed' WHERE training_id = ?")
      .run(failed.command.trainingId);
    let ids = 0;
    const port: TrainingRetractionPort = {
      retract: (command) => {
        ids += 1;
        return retractTrainingTelegrams(db.weather.connection, command, {
          venueRegistry: testVenueRegistry,
          clock,
        });
      },
    };
    const listPort: TrainingInjectionPort = {
      inject: async () => {
        throw new Error('unused');
      },
      list: async (command) => ({
        injections: listCompletedTrainingInjections(
          db.weather.connection,
          command.terminalIds,
          command.limit,
        ).map((r) => ({
          trainingId: r.trainingId,
          terminalId: r.terminalId,
          acceptedAt: r.acceptedAt,
          retractedAt: r.retractedAt,
          telegrams: r.telegrams.map((t) => ({
            sequence: t.sequence,
            telegramType: t.telegramType as never,
            title: t.title,
            previewId: t.previewId,
          })),
        })),
      }),
    };

    await withServer(port, listPort, async (call) => {
      // 形式不正は 400（Worker に到達しない）
      const invalid: unknown[] = [
        { terminalId: 'kkeagh01' },
        { terminalId: 'kkeagh01', scope: 'training' },
        { terminalId: 'kkeagh01', scope: 'training', trainingIds: [] },
        { terminalId: 'kkeagh01', scope: 'all', trainingIds: [a.command.trainingId] },
        { terminalId: 'kkeagh01', scope: 'other' },
        { terminalId: 'kkeagh01', scope: 'training', trainingIds: ['x'] },
        {
          terminalId: 'kkeagh01',
          scope: 'training',
          trainingIds: [a.command.trainingId, a.command.trainingId],
        },
        {
          terminalId: 'kkeagh01',
          scope: 'training',
          trainingIds: Array.from(
            { length: TRAINING_RETRACT_MAX_TRAINING_IDS + 1 },
            (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
          ),
        },
        { terminalId: '', scope: 'all' },
        { terminalId: 'kkeagh01', scope: 'all', extra: 1 },
        'text',
        null,
      ];
      for (const body of invalid) {
        const response = await call('POST', '/api/training/retract', body);
        assert.equal(response.status, 400, JSON.stringify(body));
        assert.equal(response.cache, 'no-store');
        assert.deepEqual(response.json, { status: 'error', code: 'invalid_request' });
      }
      assert.equal(ids, 0);
      // query 付き・不明端末は 400、H 端末は 403
      assert.equal(
        (await call('POST', '/api/training/retract?x=1', { terminalId: 'kkeagh01', scope: 'all' }))
          .status,
        400,
      );
      assert.equal(
        (await call('POST', '/api/training/retract', { terminalId: 'unknown01', scope: 'all' }))
          .status,
        400,
      );
      const forbidden = await call('POST', '/api/training/retract', {
        terminalId: 'hkeagh01',
        scope: 'all',
      });
      assert.equal(forbidden.status, 403);
      assert.deepEqual(forbidden.json, { status: 'error', code: 'forbidden_terminal' });
      assert.equal(ids, 0);

      // 存在しない ID・別会場の K 端末の訓練・failed の注入は 404 で何も処理されない
      const missingId = '99999999-9999-4999-8999-999999999999';
      const before = count(db.weather.connection, 'training_retraction');
      const receptionsBefore404 = count(db.weather.connection, 'telegram_reception');
      const notFound = await call('POST', '/api/training/retract', {
        terminalId: 'kkeagh01',
        scope: 'training',
        trainingIds: [
          a.command.trainingId,
          missingId,
          other.command.trainingId,
          failed.command.trainingId,
        ],
      });
      assert.equal(notFound.status, 404);
      assert.equal(notFound.cache, 'no-store');
      assert.equal(notFound.json.code, 'training_not_found');
      assert.deepEqual(
        [...notFound.json.trainingIds].sort(),
        [missingId, other.command.trainingId, failed.command.trainingId].sort(),
      );
      assert.equal(count(db.weather.connection, 'training_retraction'), before);
      assert.equal(count(db.weather.connection, 'telegram_reception'), receptionsBefore404);

      // 一覧: 未抹消は retractedAt が null
      const list0 = await call('GET', '/api/training/injections?terminalId=kkeagh01');
      const parsed0 = parseTrainingInjectionsResponse(list0.json);
      assert.ok(parsed0);
      assert.ok(parsed0.injections.every((i) => i.retractedAt === null));

      // 正常系: 同じ会場の別 K 端末が投入した訓練も抹消できる
      const ok = await call('POST', '/api/training/retract', {
        terminalId: 'kkeagh02',
        scope: 'training',
        trainingIds: [a.command.trainingId],
      });
      assert.equal(ok.status, 200);
      assert.equal(ok.cache, 'no-store');
      const response = parseTrainingRetractResponse(ok.json);
      assert.ok(response);
      assert.match(response.retractionId, /^a0a0a0a0-a0a0-40a0-80a0-\d{12}$/);
      assert.equal(response.scope, 'training');
      assert.deepEqual(response.trainingIds, [a.command.trainingId]);
      assert.ok(response.telegrams.every((t) => t.outcome === 'cancelled'));

      // 一覧: 抹消済みも残り、retractedAt が抹消の受付時刻
      const list1 = parseTrainingInjectionsResponse(
        (await call('GET', '/api/training/injections?terminalId=kkeagh01')).json,
      );
      assert.ok(list1);
      const row = list1.injections.find((i) => i.trainingId === a.command.trainingId)!;
      assert.equal(row.retractedAt, response.acceptedAt);
      assert.equal(list1.injections.length, parsed0.injections.length);
      assert.ok(
        list1.injections
          .filter((i) => i.trainingId !== a.command.trainingId)
          .every((i) => i.retractedAt === null),
      );

      // 既に抹消済みは 409 で何も処理されない
      const receptions = count(db.weather.connection, 'telegram_reception');
      const conflict = await call('POST', '/api/training/retract', {
        terminalId: 'kkeagh01',
        scope: 'training',
        trainingIds: [a.command.trainingId],
      });
      assert.equal(conflict.status, 409);
      assert.deepEqual(conflict.json, {
        status: 'error',
        code: 'training_already_retracted',
        trainingIds: [a.command.trainingId],
      });
      assert.equal(count(db.weather.connection, 'telegram_reception'), receptions);
    });
  } finally {
    db.close();
  }
});

test('POST /api/training/retract: 503（未構成・未準備）・504・500、直接削除ルートは存在しない', async () => {
  const body = { terminalId: 'kkeagh01', scope: 'all' };
  // ポート未構成
  await withServer(undefined, undefined, async (call) => {
    const response = await call('POST', '/api/training/retract', body);
    assert.equal(response.status, 503);
    assert.equal(response.cache, 'no-store');
    assert.deepEqual(response.json, { status: 'error', code: 'training_retraction_unavailable' });
  });
  const failing = (message: string): TrainingRetractionPort => ({
    retract: async () => {
      throw new Error(message);
    },
  });
  await withServer(failing('not_ready'), undefined, async (call) => {
    assert.equal((await call('POST', '/api/training/retract', body)).status, 503);
  });
  await withServer(failing('busy'), undefined, async (call) => {
    assert.equal((await call('POST', '/api/training/retract', body)).status, 503);
  });
  await withServer(failing('deadline_exceeded'), undefined, async (call) => {
    const response = await call('POST', '/api/training/retract', body);
    assert.equal(response.status, 504);
    assert.deepEqual(response.json, {
      status: 'error',
      code: 'training_retraction_result_unknown',
      retractionId: RETRACTION_ID,
    });
  });
  await withServer(failing('training_retraction_failed'), undefined, async (call) => {
    const response = await call('POST', '/api/training/retract', body);
    assert.equal(response.status, 500);
    assert.deepEqual(response.json, {
      status: 'error',
      code: 'training_retraction_failed',
      retractionId: RETRACTION_ID,
    });
  });
  // GET・POST 以外のルートが無い
  await withServer(failing('x'), undefined, async (call) => {
    for (const [method, path] of [
      ['DELETE', '/api/training/injections/x'],
      ['DELETE', '/api/training/injections'],
      ['DELETE', '/api/training/retract'],
      ['PUT', '/api/training/retract'],
      ['GET', '/api/training/retract'],
    ] as const) {
      const response = await call(method, path);
      assert.equal(response.status, 404, `${method} ${path}`);
    }
  });
});
