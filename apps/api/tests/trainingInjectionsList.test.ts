import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { join } from 'node:path';
import test from 'node:test';
import {
  createTerminalRegistry,
  parseTrainingInjectionsResponse,
  TRAINING_INJECTIONS_LIST_LIMIT,
  type TrainingInjectionsResponse,
} from '@wx-viewer-poc/shared';
import { createApp, type AppDependencies } from '../src/app.js';
import {
  listCompletedTrainingInjections,
  updateTrainingInjectionStatus,
} from '../src/repositories/trainingInjectionRepository.js';
import { createTrainingInjectionService } from '../src/services/trainingInjectionService.js';
import type {
  TrainingInjectionCommand,
  TrainingInjectionListCommand,
  TrainingInjectionPort,
} from '../src/training/trainingInjectionContracts.js';
import { injectTrainingTelegrams } from '../src/training/trainingInjector.js';
import { generateTrainingTelegrams } from '../src/training/trainingTelegramGenerator.js';
import { initializeTestDatabases } from './helpers/databasePair.js';
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

async function withServer<T>(
  dependencies: AppDependencies,
  run: (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    get: (path: string) => Promise<{ status: number; cache: string | null; json: any }>,
  ) => Promise<T>,
): Promise<T> {
  const server = await new Promise<Server>((resolve, reject) => {
    const listening = createApp(dependencies).listen(0, '127.0.0.1', () => resolve(listening));
    listening.once('error', reject);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('missing TCP address');
  try {
    return await run(async (path) => {
      const response = await fetch(`http://127.0.0.1:${address.port}${path}`);
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

const emptyResponse: TrainingInjectionsResponse = { injections: [] };

test('GET /api/training/injections: 端末検証・会場のK端末集合・no-store・503', async () => {
  const calls: TrainingInjectionListCommand[] = [];
  const port: TrainingInjectionPort = {
    inject: async () => {
      throw new Error('unused');
    },
    list: async (command) => {
      calls.push(command);
      return emptyResponse;
    },
  };
  const service = createTrainingInjectionService({ terminalRegistry: registry, port });
  await withServer({ trainingInjection: service }, async (get) => {
    const ok = await get('/api/training/injections?terminalId=kkeagh01');
    assert.equal(ok.status, 200);
    assert.equal(ok.cache, 'no-store');
    assert.deepEqual(ok.json, emptyResponse);
    // 同じ会場の K 端末だけ（別会場の K・同会場の H は含まない）
    assert.deepEqual([...calls[0]!.terminalIds].sort(), ['kkeagh01', 'kkeagh02']);
    assert.equal(calls[0]!.limit, TRAINING_INJECTIONS_LIST_LIMIT);

    const trc = await get('/api/training/injections?terminalId=ktrcph01');
    assert.deepEqual(calls[1]!.terminalIds, ['ktrcph01']);
    assert.equal(trc.status, 200);

    const h = await get('/api/training/injections?terminalId=hkeagh01');
    assert.equal(h.status, 403);
    assert.equal(h.cache, 'no-store');
    assert.equal((await get('/api/training/injections?terminalId=nobody')).status, 400);
    assert.equal((await get('/api/training/injections')).status, 400);
    assert.equal((await get('/api/training/injections?terminalId=kkeagh01&x=1')).status, 400);
    assert.equal(calls.length, 2);
  });

  // Worker 未準備（list が例外）・ポート未構成・list 未実装は 503
  for (const p of [
    {
      inject: async () => {
        throw new Error('unused');
      },
      list: async () => {
        throw new Error('not_ready');
      },
    } satisfies TrainingInjectionPort,
    {
      inject: async () => {
        throw new Error('unused');
      },
    } satisfies TrainingInjectionPort,
    undefined,
  ]) {
    const svc = createTrainingInjectionService({ terminalRegistry: registry, port: p });
    await withServer({ trainingInjection: svc }, async (get) => {
      const res = await get('/api/training/injections?terminalId=kkeagh01');
      assert.equal(res.status, 503);
      assert.equal(res.json.code, 'training_injection_unavailable');
      assert.equal(res.cache, 'no-store');
    });
  }
});

test('listCompletedTrainingInjections: 完了のみ・端末絞り込み・新しい順・上限・requestedのみ', async () => {
  const db = initializeTestDatabases({
    databasePath: ':memory:',
    migrationsDirectory: join(import.meta.dirname, '../migrations'),
  });
  try {
    let tick = 0;
    const inject = async (trainingId: string, terminalId: string, generationId: string) => {
      const gen = ['warning-03', 'bulletin-linear-occurrence'].map(
        (item, index) =>
          generateTrainingTelegrams([item as 'warning-03'], {
            now: '2026-10-12T09:00:00.000Z',
            generationId: generationId.slice(0, -1) + String(index),
          })[0]!,
      );
      const command: TrainingInjectionCommand = {
        trainingId,
        terminalId,
        requestedAt: '2026-10-12T10:00:00.000Z',
        telegrams: gen.map((g, order) => ({
          order,
          previewId: `${generationId.slice(0, -1) + String(order)}:0`,
          reportDateTime: g.reportDateTime,
          telegramType: g.telegramType,
          xml: g.xml,
        })),
      };
      tick += 1;
      const at = new Date(Date.UTC(2026, 9, 12, 10, 0, tick)).toISOString();
      return injectTrainingTelegrams(db.weather.connection, command, {
        venueRegistry: testVenueRegistry,
        clock: () => at,
      });
    };
    const ids = [
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000002',
      '00000000-0000-4000-8000-000000000003',
      '00000000-0000-4000-8000-000000000004',
    ];
    await inject(ids[0]!, 'kkeagh01', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1');
    await inject(ids[1]!, 'kkeagh02', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2');
    await inject(ids[2]!, 'ktrcph01', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3');
    await inject(ids[3]!, 'kkeagh01', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4');
    // 4つ目を failed にする（一覧に出ない）
    updateTrainingInjectionStatus(db.weather.connection, ids[3]!, {
      status: 'failed',
      finishedAt: '2026-10-12T10:10:00.000Z',
      errorCode: 'x',
    });

    const list = listCompletedTrainingInjections(
      db.weather.connection,
      ['kkeagh01', 'kkeagh02'],
      50,
    );
    assert.deepEqual(
      list.map((i) => i.trainingId),
      [ids[1], ids[0]],
    );
    assert.equal(list[0]!.terminalId, 'kkeagh02');
    // 要求電文のみ（基準電文 VPWS50 は出ない）、sequence 昇順、title は受信の題名
    const types = list[0]!.telegrams.map((t) => t.telegramType);
    assert.equal(types.includes('VPWS50' as never), false);
    assert.equal(types.length, 2);
    const seqs = list[0]!.telegrams.map((t) => t.sequence);
    assert.deepEqual(
      seqs,
      [...seqs].sort((a, b) => a - b),
    );
    assert.ok(list[0]!.telegrams.every((t) => t.previewId.endsWith(':0')));
    assert.ok(list[0]!.telegrams.some((t) => typeof t.title === 'string' && t.title.length > 0));
    // limit
    assert.equal(
      listCompletedTrainingInjections(db.weather.connection, ['kkeagh01', 'kkeagh02'], 1).length,
      1,
    );
    assert.equal(listCompletedTrainingInjections(db.weather.connection, [], 50).length, 0);
    // 別会場
    assert.deepEqual(
      listCompletedTrainingInjections(db.weather.connection, ['ktrcph01'], 50).map(
        (i) => i.trainingId,
      ),
      [ids[2]],
    );
    // 応答形式を共有パーサーで検証
    assert.ok(
      parseTrainingInjectionsResponse({
        injections: list.map((i) => ({ ...i, telegrams: [...i.telegrams] })),
      }),
    );
  } finally {
    db.close();
  }
});
