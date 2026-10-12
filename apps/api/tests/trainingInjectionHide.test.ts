import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import test from 'node:test';
import {
  createTerminalRegistry,
  parseTrainingInjectionsHideResponse,
  parseTrainingInjectionsResponse,
  TRAINING_INJECTIONS_LIST_LIMIT,
} from '@wx-viewer-poc/shared';
import { createApp } from '../src/app.js';
import { listAcceptanceReceptions } from '../src/acceptance/trainingExclusion.js';
import { listCompletedTrainingInjections } from '../src/repositories/trainingInjectionRepository.js';
import { createTrainingInjectionHideService } from '../src/services/trainingInjectionHideService.js';
import { createTrainingInjectionService } from '../src/services/trainingInjectionService.js';
import { hideTrainingInjections } from '../src/training/trainingInjectionHide.js';
import type { TrainingInjectionsHidePort } from '../src/training/trainingInjectionContracts.js';
import {
  fixedClock,
  inject,
  retract,
  retractionCommand,
  setupDb,
  count,
} from './helpers/trainingRetraction.js';
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
const GEN_TIME = '2026-10-12T09:00:00.000Z';

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

async function withServer<T>(
  port: TrainingInjectionsHidePort | undefined,
  listPort: Parameters<typeof createTrainingInjectionService>[0]['port'],
  run: (
    call: (
      method: string,
      path: string,
      body?: unknown,
    ) => Promise<{ status: number; cache: string | null; json: Json }>,
  ) => Promise<T>,
): Promise<T> {
  const app = createApp({
    trainingInjectionHide: createTrainingInjectionHideService({
      terminalRegistry: registry,
      port,
      now: () => '2026-10-12T11:00:00.000Z',
    }),
    trainingInjection: createTrainingInjectionService({
      terminalRegistry: registry,
      port: listPort,
    }),
  });
  const server = await new Promise<Server>((resolve, reject) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
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

function rowDump(db: ReturnType<typeof setupDb>) {
  const w = db.weather.connection;
  const dump: Record<string, unknown> = {};
  for (const table of [
    'training_injection',
    'training_injection_reception',
    'training_retraction',
    'training_retraction_target',
    'training_retraction_item',
    'telegram_reception',
    'fetch_attempt',
    'bosai_bulletin',
  ]) {
    dump[table] = w.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();
  }
  dump.history = db.retained.connection.prepare('SELECT * FROM notification_output_history').all();
  return JSON.stringify(dump);
}

test('POST /api/training/injections/hide: 抹消済みだけ外せ、一覧から消える。冪等・409・404・400・403・503、前後で他の記録は不変', async () => {
  const db = setupDb();
  try {
    const clock = fixedClock();
    const a = await inject(db.weather.connection, ['warning-03'], { now: GEN_TIME, clock });
    const b = await inject(db.weather.connection, ['bulletin-tornado'], { now: GEN_TIME, clock });
    const other = await inject(db.weather.connection, ['warning-14'], {
      now: GEN_TIME,
      clock,
      terminalId: 'ktrcph01',
    });
    await retract(
      db.weather.connection,
      retractionCommand('training', [a.command.trainingId]),
      clock,
    );
    await retract(
      db.weather.connection,
      {
        ...retractionCommand('training', [other.command.trainingId]),
        terminalId: 'ktrcph01',
        allowedTerminalIds: ['ktrcph01'],
      },
      clock,
    );
    const idA = a.command.trainingId;
    const idB = b.command.trainingId;
    const idOther = other.command.trainingId;
    const hidden = () =>
      db.weather.connection.prepare('SELECT * FROM training_injection_list_hidden').all();

    const hidePort: TrainingInjectionsHidePort = {
      hide: async (command) => hideTrainingInjections(db.weather.connection, command),
    };
    const listPort = {
      inject: async () => {
        throw new Error('unused');
      },
      list: async (command: { terminalIds: readonly string[]; limit: number }) => ({
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
    const listIds = async (
      call: Parameters<Parameters<typeof withServer>[2]>[0],
      terminal: string,
    ) =>
      parseTrainingInjectionsResponse(
        (await call('GET', `/api/training/injections?terminalId=${terminal}`)).json,
      )!.injections.map((i) => i.trainingId);

    await withServer(hidePort, listPort, async (call) => {
      const url = '/api/training/injections/hide';
      // 形式不正は 400、H は 403
      const invalid: unknown[] = [
        { terminalId: 'kkeagh01' },
        { terminalId: 'kkeagh01', trainingIds: [] },
        { terminalId: 'kkeagh01', trainingIds: ['x'] },
        { terminalId: 'kkeagh01', trainingIds: [idA, idA] },
        { terminalId: 'kkeagh01', trainingIds: [idA], extra: 1 },
        {
          terminalId: 'kkeagh01',
          trainingIds: Array.from(
            { length: 51 },
            (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
          ),
        },
        { terminalId: 'unknown01', trainingIds: [idA] },
      ];
      for (const body of invalid) {
        const response = await call('POST', url, body);
        assert.equal(response.status, 400, JSON.stringify(body));
        assert.equal(response.cache, 'no-store');
      }
      assert.equal(
        (await call('POST', `${url}?x=1`, { terminalId: 'kkeagh01', trainingIds: [idA] })).status,
        400,
      );
      assert.equal(
        (await call('POST', url, { terminalId: 'hkeagh01', trainingIds: [idA] })).status,
        403,
      );

      const before = rowDump(db);
      // 未抹消を含む → 409、別会場・存在しない → 404。どちらも1件も記録しない
      const conflict = await call('POST', url, { terminalId: 'kkeagh01', trainingIds: [idA, idB] });
      assert.equal(conflict.status, 409);
      assert.deepEqual(conflict.json, {
        status: 'error',
        code: 'training_not_retracted',
        trainingIds: [idB],
      });
      const missing = '99999999-9999-4999-8999-999999999999';
      const notFound = await call('POST', url, {
        terminalId: 'kkeagh01',
        trainingIds: [idA, idOther, missing],
      });
      assert.equal(notFound.status, 404);
      assert.equal(notFound.json.code, 'training_not_found');
      assert.deepEqual([...notFound.json.trainingIds].sort(), [idOther, missing].sort());
      assert.deepEqual(hidden(), []);
      assert.equal(rowDump(db), before);

      // 成功: 一覧から消え、同じ会場の別の K 端末の一覧からも消える
      assert.ok((await listIds(call, 'kkeagh01')).includes(idA));
      const ok = await call('POST', url, { terminalId: 'kkeagh01', trainingIds: [idA] });
      assert.equal(ok.status, 200);
      assert.equal(ok.cache, 'no-store');
      assert.deepEqual(parseTrainingInjectionsHideResponse(ok.json), { hiddenTrainingIds: [idA] });
      for (const terminal of ['kkeagh01', 'kkeagh02']) {
        const ids = await listIds(call, terminal);
        assert.ok(!ids.includes(idA));
        assert.ok(ids.includes(idB));
      }
      // 再度は 200 で記録は変わらない
      const first = hidden();
      assert.equal(first.length, 1);
      const again = await call('POST', url, { terminalId: 'kkeagh02', trainingIds: [idA] });
      assert.equal(again.status, 200);
      assert.deepEqual(hidden(), first);

      // hide の前後で他の記録・受入対象は不変
      const acceptance = JSON.stringify(
        listAcceptanceReceptions(db.weather.connection, {
          from: '2000-01-01T00:00:00.000Z',
          to: '2100-01-01T00:00:00.000Z',
        }),
      );
      const afterDump = rowDump(db);
      await call('POST', url, { terminalId: 'ktrcph01', trainingIds: [idOther] });
      assert.equal(rowDump(db), afterDump);
      assert.equal(
        JSON.stringify(
          listAcceptanceReceptions(db.weather.connection, {
            from: '2000-01-01T00:00:00.000Z',
            to: '2100-01-01T00:00:00.000Z',
          }),
        ),
        acceptance,
      );
      assert.equal(count(db.weather.connection, 'training_injection_list_hidden'), 2);
    });

    // 503: ポート未構成 / Worker 未準備
    await withServer(undefined, undefined, async (call) => {
      const response = await call('POST', '/api/training/injections/hide', {
        terminalId: 'kkeagh01',
        trainingIds: [idA],
      });
      assert.equal(response.status, 503);
      assert.deepEqual(response.json, { status: 'error', code: 'training_injection_unavailable' });
    });
    await withServer(
      {
        hide: async () => {
          throw new Error('not_ready');
        },
      },
      undefined,
      async (call) => {
        assert.equal(
          (
            await call('POST', '/api/training/injections/hide', {
              terminalId: 'kkeagh01',
              trainingIds: [idA],
            })
          ).status,
          503,
        );
        assert.equal((await call('DELETE', '/api/training/injections/hide')).status, 404);
      },
    );
  } finally {
    db.close();
  }
});

test('一覧の50件の上限は外していない行で数える', async () => {
  const db = setupDb();
  try {
    const clock = fixedClock();
    const ids: string[] = [];
    for (let i = 0; i < TRAINING_INJECTIONS_LIST_LIMIT + 2; i += 1) {
      const trainingId = `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
      db.weather.connection
        .prepare(
          "INSERT INTO training_injection (training_id, terminal_id, requested_at, accepted_at, finished_at, telegram_count, status) VALUES (?, 'kkeagh01', ?, ?, ?, 1, 'completed')",
        )
        .run(trainingId, GEN_TIME, `2026-10-12T10:00:${String(i).padStart(2, '0')}.000Z`, GEN_TIME);
      ids.push(trainingId);
    }
    void clock;
    // 最新の2件（i=51,50）を外した状態
    db.weather.connection
      .prepare(
        "INSERT INTO training_injection_list_hidden VALUES (?, 'x', 'kkeagh01'), (?, 'x', 'kkeagh01')",
      )
      .run(ids[51], ids[50]);
    const listed = listCompletedTrainingInjections(
      db.weather.connection,
      ['kkeagh01'],
      TRAINING_INJECTIONS_LIST_LIMIT,
    );
    assert.equal(listed.length, TRAINING_INJECTIONS_LIST_LIMIT);
    assert.equal(listed[0]!.trainingId, ids[49]);
    assert.equal(listed.at(-1)!.trainingId, ids[0]);
  } finally {
    db.close();
  }
});
