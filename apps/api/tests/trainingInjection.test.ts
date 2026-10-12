import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { join } from 'node:path';
import test from 'node:test';
import { TRAINING_INJECT_MAX_BODY_BYTES, type TrainingInjectRequest } from '@wx-viewer-poc/shared';
import { createApp, type AppDependencies } from '../src/app.js';
import { listTelegramReceptions } from '../src/repositories/index.js';
import {
  listRecentAdoptionFailures,
  summarizeAdoptionResults,
} from '../src/repositories/telegramReceptionRepository.js';
import {
  findTrainingInjection,
  listTrainingInjectionReceptions,
} from '../src/repositories/trainingInjectionRepository.js';
import { findWarningCurrentStream } from '../src/repositories/warningCurrentStreamRepository.js';
import { createTrainingInjectionService } from '../src/services/trainingInjectionService.js';
import { createTrainingTelegramService } from '../src/services/trainingTelegramService.js';
import type {
  TrainingInjectionCommand,
  TrainingInjectionPort,
} from '../src/training/trainingInjectionContracts.js';
import { injectTrainingTelegrams } from '../src/training/trainingInjector.js';
import { generateTrainingTelegrams } from '../src/training/trainingTelegramGenerator.js';
import { initializeTestDatabases } from './helpers/databasePair.js';
import { testTerminalRegistry, testVenueRegistry } from './helpers/venueConfigPreload.js';

const K_EAST = 'kkeagh01';
const H_EAST = 'hkeagh01';
const NOW = '2026-10-12T10:00:00.000Z';

type Caller = (
  method: string,
  path: string,
  body?: string,
  contentType?: string,
) => Promise<{
  status: number;
  cacheControl: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  json: any;
  raw: string;
}>;

async function withServer<T>(
  dependencies: AppDependencies,
  run: (call: Caller) => Promise<T>,
): Promise<T> {
  const server = await new Promise<Server>((resolve, reject) => {
    const listening = createApp(dependencies).listen(0, '127.0.0.1', () => resolve(listening));
    listening.once('error', reject);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('missing TCP address');
  const base = `http://127.0.0.1:${address.port}`;
  const call: Caller = async (method, path, body, contentType = 'application/json') => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: body === undefined ? {} : { 'content-type': contentType },
      body,
    });
    const raw = await response.text();
    let json: unknown = null;
    try {
      json = JSON.parse(raw);
    } catch {
      // ignore
    }
    return {
      status: response.status,
      cacheControl: response.headers.get('cache-control'),
      json,
      raw,
    };
  };
  try {
    return await run(call);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}

function setupDb() {
  return initializeTestDatabases({
    databasePath: ':memory:',
    migrationsDirectory: join(import.meta.dirname, '../migrations'),
  });
}

test('POST /api/training/inject: HTTP API 正常系と異常系', async () => {
  const genService = createTrainingTelegramService({
    terminalRegistry: testTerminalRegistry,
    now: () => NOW,
    idFactory: () => '11111111-1111-4111-8111-111111111111',
  });
  const preview = genService.generate({
    terminalId: K_EAST,
    itemIds: ['warning-03'], // レベル3大雨警報
  });
  assert.equal(preview.kind, 'ok');
  const validTelegram = preview.value.telegrams[0]!;

  const mockPort: TrainingInjectionPort = {
    inject: async (cmd) => ({
      trainingId: cmd.trainingId,
      injectedAt: NOW,
      telegrams: cmd.telegrams.map((t, idx) => ({
        previewId: t.previewId,
        sequence: idx,
        telegramType: t.telegramType,
        receptionId: 100 + idx,
        documentUrl: `training://${cmd.trainingId}/${idx}_${t.telegramType}_training.xml`,
        adoptions: [
          { venueId: 'east', adoptionResult: '気象警報等として解析済み', adoptionReason: null },
        ],
      })),
      baseline: null,
    }),
  };

  const injectionService = createTrainingInjectionService({
    terminalRegistry: testTerminalRegistry,
    port: mockPort,
    now: () => NOW,
  });

  await withServer({ trainingInjection: injectionService }, async (call) => {
    // 1. K端末で正常系 -> 200
    const validBody: TrainingInjectRequest = {
      terminalId: K_EAST,
      telegrams: [
        {
          previewId: validTelegram.id,
          generatedAt: preview.value.generatedAt,
          itemIds: validTelegram.itemIds,
          telegramType: validTelegram.telegramType,
          xml: validTelegram.xml,
        },
      ],
    };
    const res200 = await call('POST', '/api/training/inject', JSON.stringify(validBody));
    assert.equal(res200.status, 200);
    assert.equal(res200.cacheControl, 'no-store');
    assert.match(
      res200.json.trainingId,
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    assert.equal(res200.json.telegrams.length, 1);
    assert.equal(res200.json.telegrams[0].sequence, 0);

    // 2. H端末 -> 403
    const hBody = { ...validBody, terminalId: H_EAST };
    const res403 = await call('POST', '/api/training/inject', JSON.stringify(hBody));
    assert.equal(res403.status, 403);
    assert.equal(res403.json.code, 'forbidden_terminal');
    assert.equal(res403.cacheControl, 'no-store');

    // 3. 不明端末 -> 400
    const unknownTermBody = { ...validBody, terminalId: 'unknown_term' };
    const resUnknown = await call('POST', '/api/training/inject', JSON.stringify(unknownTermBody));
    assert.equal(resUnknown.status, 400);
    assert.equal(resUnknown.json.code, 'invalid_request');

    // 4. query付き -> 400
    const resQuery = await call('POST', '/api/training/inject?foo=bar', JSON.stringify(validBody));
    assert.equal(resQuery.status, 400);

    // 5. 0件 -> 400
    const res0 = await call(
      'POST',
      '/api/training/inject',
      JSON.stringify({ terminalId: K_EAST, telegrams: [] }),
    );
    assert.equal(res0.status, 400);

    // 6. 余分なキー -> 400
    const resExtraKey = await call(
      'POST',
      '/api/training/inject',
      JSON.stringify({ ...validBody, extra: 'bad' }),
    );
    assert.equal(resExtraKey.status, 400);

    // 7. previewId 重複 -> 400
    const resDup = await call(
      'POST',
      '/api/training/inject',
      JSON.stringify({
        terminalId: K_EAST,
        telegrams: [validBody.telegrams[0]!, validBody.telegrams[0]!],
      }),
    );
    assert.equal(resDup.status, 400);

    // 8. xml 改ざん -> 422
    const tamperedBody = {
      terminalId: K_EAST,
      telegrams: [
        {
          ...validBody.telegrams[0]!,
          xml: validBody.telegrams[0]!.xml.replace('気象庁', '気象庁改ざん'),
        },
      ],
    };
    const res422 = await call('POST', '/api/training/inject', JSON.stringify(tamperedBody));
    assert.equal(res422.status, 422);
    assert.equal(res422.json.code, 'training_verification_failed');
    assert.equal(res422.json.failures[0].reason, 'regeneration_mismatch');

    // 9. generatedAt 改ざん (1ms) -> 422
    // 秒境界（.999Z）で1ms変えることで再生成XMLのControl/DateTime（秒単位）が変わり不一致になる
    const testGenId = '99999999-9999-4999-8999-999999999999';
    const baseMs = Date.parse('2026-10-12T10:00:00.999Z');
    const xmlAtBoundary = generateTrainingTelegrams(['warning-03'], {
      now: new Date(baseMs).toISOString(),
      generationId: testGenId,
    })[0]!.xml;
    const tamperedTimeBody = {
      terminalId: K_EAST,
      telegrams: [
        {
          previewId: `${testGenId}:0`,
          generatedAt: new Date(baseMs + 1).toISOString(), // 1ms 変えたもの
          itemIds: ['warning-03' as const],
          telegramType: 'VPWW55' as const,
          xml: xmlAtBoundary,
        },
      ],
    };
    const res422Time = await call('POST', '/api/training/inject', JSON.stringify(tamperedTimeBody));
    assert.equal(res422Time.status, 422);
    assert.equal(res422Time.json.failures[0].reason, 'regeneration_mismatch');

    // 10. 384KiB超ボディ -> 413
    const largePadding = ' '.repeat(TRAINING_INJECT_MAX_BODY_BYTES + 10);
    const res413 = await call(
      'POST',
      '/api/training/inject',
      JSON.stringify({ ...validBody, _pad: largePadding }),
    );
    assert.equal(res413.status, 413);
    assert.equal(res413.json.code, 'request_too_large');
    assert.equal(res413.cacheControl, 'no-store');
  });

  const validInjectBody = {
    terminalId: K_EAST,
    telegrams: [
      {
        previewId: validTelegram.id,
        generatedAt: preview.value.generatedAt,
        itemIds: validTelegram.itemIds,
        telegramType: validTelegram.telegramType,
        xml: validTelegram.xml,
      },
    ],
  };

  // 11. ポート未構成 -> 503
  const noPortService = createTrainingInjectionService({
    terminalRegistry: testTerminalRegistry,
    now: () => NOW,
  });
  await withServer({ trainingInjection: noPortService }, async (call) => {
    const res503 = await call('POST', '/api/training/inject', JSON.stringify(validInjectBody));
    assert.equal(res503.status, 503);
    assert.equal(res503.json.code, 'training_injection_unavailable');
  });

  // 12. サービス未登録 (createApp({})) -> 404
  await withServer({}, async (call) => {
    const res404 = await call('POST', '/api/training/inject', JSON.stringify(validInjectBody));
    assert.equal(res404.status, 404);
  });
});

test('Worker injectTrainingTelegrams: 基準電文(H1)の成立とパイプライン投入、冪等性、監視除外', async () => {
  const db = setupDb();
  try {
    const clock = () => '2026-10-12T10:00:00.000Z';

    // 1. レベル3大雨警報（VPWW55）の生成
    const gen = generateTrainingTelegrams(['warning-03'], {
      now: '2026-10-12T09:00:00.000Z',
      generationId: '22222222-2222-4222-8222-222222222222',
    });
    const telegram1 = gen[0]!;

    const trainingId1 = '33333333-3333-4333-8333-333333333333';
    const command1: TrainingInjectionCommand = {
      trainingId: trainingId1,
      terminalId: K_EAST,
      requestedAt: '2026-10-12T10:00:00.000Z',
      telegrams: [
        {
          order: 0,
          previewId: '22222222-2222-4222-8222-222222222222:0',
          reportDateTime: telegram1.reportDateTime,
          telegramType: telegram1.telegramType,
          xml: telegram1.xml,
        },
      ],
    };

    // 注入前のストリーム確認（未初期化）
    assert.equal(
      findWarningCurrentStream(db.weather.connection, '130000', '1310800', 'training', 'VPWS50'),
      null,
    );

    // 投入実行
    const result1 = await injectTrainingTelegrams(db.weather.connection, command1, {
      venueRegistry: testVenueRegistry,
      clock,
    });

    // A. 基準電文が投入されたことの検証 (sequence 0, baseline非null)
    assert.ok(result1.baseline);
    assert.equal(result1.baseline.sequence, 0);
    assert.equal(result1.baseline.documentUrl, `training://${trainingId1}/0_VPWS50_training.xml`);
    assert.equal(result1.telegrams.length, 1);
    assert.equal(result1.telegrams[0]!.sequence, 1);
    assert.equal(
      result1.telegrams[0]!.documentUrl,
      `training://${trainingId1}/1_VPWW55_training.xml`,
    );

    // B. 注入記録テーブルの確認
    const injRecord = findTrainingInjection(db.weather.connection, trainingId1);
    assert.ok(injRecord);
    assert.equal(injRecord.status, 'completed');
    assert.equal(injRecord.telegramCount, 1); // 基準電文を含まない要求電文数
    const injReceptions = listTrainingInjectionReceptions(db.weather.connection, trainingId1);
    assert.equal(injReceptions.length, 2);
    assert.equal(injReceptions[0]!.role, 'baseline');
    assert.equal(injReceptions[0]!.sequence, 0);
    assert.equal(injReceptions[1]!.role, 'requested');
    assert.equal(injReceptions[1]!.sequence, 1);

    // C. 訓練VPWS50ストリームが現況に成立したこと
    const stream = findWarningCurrentStream(
      db.weather.connection,
      '130000',
      '1310800',
      'training',
      'VPWS50',
    );
    assert.ok(stream);

    // D. 2回目の注入（雷注意報）: 基準電文を再投入しない
    const gen2 = generateTrainingTelegrams(['warning-14'], {
      now: '2026-10-12T09:10:00.000Z',
      generationId: '44444444-4444-4444-8444-444444444444',
    });
    const telegram2 = gen2[0]!;
    const trainingId2 = '55555555-5555-4555-8555-555555555555';
    const command2: TrainingInjectionCommand = {
      trainingId: trainingId2,
      terminalId: K_EAST,
      requestedAt: '2026-10-12T10:05:00.000Z',
      telegrams: [
        {
          order: 0,
          previewId: '44444444-4444-4444-8444-444444444444:0',
          reportDateTime: telegram2.reportDateTime,
          telegramType: telegram2.telegramType,
          xml: telegram2.xml,
        },
      ],
    };

    const result2 = await injectTrainingTelegrams(db.weather.connection, command2, {
      venueRegistry: testVenueRegistry,
      clock,
    });
    // 基準電文は投入されない (baseline: null, sequence 0)
    assert.equal(result2.baseline, null);
    assert.equal(result2.telegrams.length, 1);
    assert.equal(result2.telegrams[0]!.sequence, 0);

    // E. 冪等性検証: 同じ trainingId を2回呼んでも結果が同じでDB行は増えない
    const recCountBefore = listTelegramReceptions(db.weather.connection).length;
    const result2Retry = await injectTrainingTelegrams(db.weather.connection, command2, {
      venueRegistry: testVenueRegistry,
      clock,
    });
    const recCountAfter = listTelegramReceptions(db.weather.connection).length;
    assert.equal(recCountBefore, recCountAfter);
    assert.equal(result2Retry.trainingId, result2.trainingId);

    // F. 監視集計の除外確認: summarizeAdoptionResults と listRecentAdoptionFailures に training が含まれない
    const adoptions = summarizeAdoptionResults(db.weather.connection, '2026-10-12T00:00:00.000Z');
    // feed_kind='training' は除外されているため、注入の集計行は0件
    assert.equal(adoptions.length, 0);

    const failures = listRecentAdoptionFailures(
      db.weather.connection,
      '2026-10-12T00:00:00.000Z',
      10,
    );
    assert.equal(failures.length, 0);

    // G. 受信履歴一覧には残っていること（H5: 受信履歴は変更しない）
    const allReceptions = listTelegramReceptions(db.weather.connection);
    assert.ok(allReceptions.some((r) => r.feedKind === 'training'));
  } finally {
    db.close();
  }
});

test('Worker injectTrainingTelegrams: 速報だけの注入では baseline: null', async () => {
  const db = setupDb();
  try {
    const clock = () => '2026-10-12T10:00:00.000Z';
    const gen = generateTrainingTelegrams(['bulletin-tornado'], {
      now: '2026-10-12T09:00:00.000Z',
      generationId: '66666666-6666-4666-8666-666666666666',
    });
    const telegram = gen[0]!;
    const trainingId = '77777777-7777-4777-8777-777777777777';
    const command: TrainingInjectionCommand = {
      trainingId,
      terminalId: K_EAST,
      requestedAt: '2026-10-12T10:00:00.000Z',
      telegrams: [
        {
          order: 0,
          previewId: '66666666-6666-4666-8666-666666666666:0',
          reportDateTime: telegram.reportDateTime,
          telegramType: telegram.telegramType,
          xml: telegram.xml,
        },
      ],
    };

    const result = await injectTrainingTelegrams(db.weather.connection, command, {
      venueRegistry: testVenueRegistry,
      clock,
    });
    assert.equal(result.baseline, null);
    assert.equal(result.telegrams[0]!.sequence, 0);
  } finally {
    db.close();
  }
});

test('HTTP API: 呼出し期限切れは 504 で trainingId を含み、未準備は 503', async () => {
  const genService = createTrainingTelegramService({
    terminalRegistry: testTerminalRegistry,
    now: () => NOW,
    idFactory: () => '11111111-1111-4111-8111-111111111111',
  });
  const preview = genService.generate({
    terminalId: K_EAST,
    itemIds: ['warning-03'],
  });
  if (preview.kind !== 'ok') throw new Error('preview failed');
  const validTelegram = preview.value.telegrams[0]!;
  const validBody: TrainingInjectRequest = {
    terminalId: K_EAST,
    telegrams: [
      {
        previewId: validTelegram.id,
        generatedAt: preview.value.generatedAt,
        itemIds: validTelegram.itemIds,
        telegramType: validTelegram.telegramType,
        xml: validTelegram.xml,
      },
    ],
  };

  // 1. 期限切れ (deadline_exceeded) -> 504
  const timeoutPort: TrainingInjectionPort = {
    inject: async () => {
      throw new Error('deadline_exceeded');
    },
  };
  const timeoutService = createTrainingInjectionService({
    terminalRegistry: testTerminalRegistry,
    port: timeoutPort,
    now: () => NOW,
    idFactory: () => 'timeout-training-id',
  });
  await withServer({ trainingInjection: timeoutService }, async (call) => {
    const res504 = await call('POST', '/api/training/inject', JSON.stringify(validBody));
    assert.equal(res504.status, 504);
    assert.equal(res504.json.code, 'training_injection_result_unknown');
    assert.equal(res504.json.trainingId, 'timeout-training-id');
  });

  // 2. not_ready -> 503
  const notReadyPort: TrainingInjectionPort = {
    inject: async () => {
      throw new Error('not_ready');
    },
  };
  const notReadyService = createTrainingInjectionService({
    terminalRegistry: testTerminalRegistry,
    port: notReadyPort,
    now: () => NOW,
  });
  await withServer({ trainingInjection: notReadyService }, async (call) => {
    const res503 = await call('POST', '/api/training/inject', JSON.stringify(validBody));
    assert.equal(res503.status, 503);
    assert.equal(res503.json.code, 'training_injection_unavailable');
  });
});

test('基準電文は J1 の項目に出ない: GET /api/training/items に VPWS50 が現れず、33項目・16group のまま', async () => {
  const genService = createTrainingTelegramService({
    terminalRegistry: testTerminalRegistry,
    now: () => NOW,
    idFactory: () => 'fixed-id',
  });
  await withServer({ trainingTelegram: genService }, async (call) => {
    const res = await call('GET', `/api/training/items?terminalId=${K_EAST}`);
    assert.equal(res.status, 200);
    assert.equal(res.json.items.length, 33);
    assert.ok(!res.json.items.some((item: { id: string }) => item.id.includes('VPWS50')));
  });
});
